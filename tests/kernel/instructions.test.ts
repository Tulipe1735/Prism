import type { SessionSummary } from "../../src/kernel/session.ts";
import type { Tool } from "../../src/kernel/tool.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { api, connectEvents, type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;

afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

async function start(
  options: Parameters<typeof startTestKernel>[0] = {},
): Promise<KernelHarness> {
  harness = await startTestKernel(options);
  return harness;
}

async function createSession(url: string, workspace: string): Promise<SessionSummary> {
  const response = await api<{ session: SessionSummary }>(url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(response.status).toBe(201);
  return response.body.session;
}

async function sendMessage(
  url: string,
  sessionId: string,
  text: string,
): Promise<void> {
  const response = await api(url, `/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { text },
  });
  expect(response.status).toBe(202);
}

it("loads AGENTS.md from the global root, the ancestors and the workspace", async () => {
  const { kernel, model, workspace, home } = await start({
    answers: [{ text: ["ok"] }, { text: ["ok"] }],
  });
  const global = join(home, ".agents", "AGENTS.md");
  await mkdir(dirname(global), { recursive: true });
  await writeFile(global, "GLOBAL-RULE: answer in the user's language.\n");
  await writeFile(
    join(dirname(workspace), "AGENTS.md"),
    "ANCESTOR-RULE: keep commits small.\n",
  );
  await writeFile(
    join(workspace, "AGENTS.md"),
    "WORKSPACE-RULE: run pnpm typecheck.\n",
  );

  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  await sendMessage(kernel.url, session.id, "hello");
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 2,
  );

  const prompt = model.requests[0]?.messages[0]?.content ?? "";
  expect(prompt).toContain("GLOBAL-RULE");
  expect(prompt).toContain("ANCESTOR-RULE");
  expect(prompt).toContain("WORKSPACE-RULE");
  // Outermost first, so the closest file wins; every file names its own path.
  expect(prompt.indexOf("GLOBAL-RULE")).toBeLessThan(prompt.indexOf("ANCESTOR-RULE"));
  expect(prompt.indexOf("ANCESTOR-RULE")).toBeLessThan(
    prompt.indexOf("WORKSPACE-RULE"),
  );
  expect(prompt).toContain(global);

  // Changes take effect in the next request, with no restart.
  await writeFile(join(workspace, "AGENTS.md"), "WORKSPACE-RULE-V2\n");
  await sendMessage(kernel.url, session.id, "again");
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );
  const next = model.requests[1]?.messages[0]?.content ?? "";
  expect(next).toContain("WORKSPACE-RULE-V2");
  expect(next).not.toContain("WORKSPACE-RULE:");
  events.close();
});

it("loads a nested AGENTS.md once a tool explores its directory", async () => {
  /** Stand-in for the file tools of ticket 03: reports the path it explored. */
  const exploreTool: Tool = {
    name: "explore",
    description: "Test stand-in for the workspace file tools.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Explored path." } },
      required: ["path"],
      additionalProperties: false,
    },
    execute: async (args, context) => {
      const path = (args as { path?: string }).path ?? "";
      context.noteExplored?.(path);
      return { content: `explored ${path}` };
    },
  };
  const { kernel, model, workspace } = await start({
    tools: [exploreTool],
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "explore", arguments: '{"path":"packages/app"}' },
        ],
      },
      { text: ["seen"] },
      { text: ["still here"] },
    ],
  });
  await mkdir(join(workspace, "packages", "app"), { recursive: true });
  await writeFile(join(workspace, "packages", "AGENTS.md"), "PACKAGES-RULE\n");
  await writeFile(join(workspace, "packages", "app", "AGENTS.md"), "APP-RULE\n");

  const events = await connectEvents(`${kernel.url}/events`);
  const session = await createSession(kernel.url, workspace);
  await sendMessage(kernel.url, session.id, "explore the app package");
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 4,
  );

  // The round that ran the tool cannot know the nested files yet.
  expect(
    model.requests[0]?.messages.map((message) => message.content).join("\n"),
  ).not.toContain("PACKAGES-RULE");
  // The round after the tool explored the directory carries both nested files.
  const notes = (model.requests[1]?.messages ?? []).filter(
    (message) => message.role === "system" && (message.content ?? "").includes("-RULE"),
  );
  expect(notes.map((note) => note.content).join("\n")).toContain("PACKAGES-RULE");
  expect(notes.map((note) => note.content).join("\n")).toContain("APP-RULE");
  expect(notes).toHaveLength(2);

  // Later tasks keep them, with no duplicate notes.
  await sendMessage(kernel.url, session.id, "keep going");
  await events.waitFor(
    (event) => event.type === "session.updated" && event.session.entryCount === 6,
  );
  const later = model.requests[2]?.messages ?? [];
  const kept = later.filter(
    (message) => message.role === "system" && (message.content ?? "").includes("-RULE"),
  );
  expect(kept).toHaveLength(2);
  expect(kept.map((note) => note.content).join("\n")).toContain("APP-RULE");
  events.close();
});
