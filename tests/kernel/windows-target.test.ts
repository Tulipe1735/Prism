import type { SessionSummary } from "../../src/kernel/session.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, beforeAll, expect, it } from "vitest";
import { windowsInteropStatus } from "../../src/kernel/windows-command.ts";
import { api, connectEvents, type KernelHarness, startTestKernel } from "./harness.ts";

const harnesses: KernelHarness[] = [];
let unavailable = "";
/** Directory on a Windows drive that Windows commands can start in. */
let windowsDir = "";
const created: string[] = [];

beforeAll(async () => {
  const status = await windowsInteropStatus();
  if (status.available) windowsDir = status.interop.spawnDir;
  else unavailable = status.reason;
});

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((started) => started.cleanup()));
  await Promise.all(
    created.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function createSession(url: string, workspace: string): Promise<SessionSummary> {
  const response = await api<{ session: SessionSummary }>(url, "/sessions", {
    method: "POST",
    body: { workspace },
  });
  expect(response.status).toBe(201);
  return response.body.session;
}

/** Runs one run_command call through the kernel and returns its report. */
async function runCommand(
  args: Record<string, unknown>,
  options: { workspace?: string; prepare?: (workspace: string) => Promise<void> } = {},
): Promise<{ result: string; isError: boolean; workspace: string }> {
  const harness = await startTestKernel({
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    answers: [
      {
        toolCalls: [
          { id: "call_1", name: "run_command", arguments: JSON.stringify(args) },
        ],
      },
      { text: ["Done."] },
    ],
  });
  harnesses.push(harness);
  const events = await connectEvents(`${harness.kernel.url}/events`);
  const session = await createSession(harness.kernel.url, harness.workspace);
  await options.prepare?.(harness.workspace);

  await api(harness.kernel.url, `/sessions/${session.id}/messages`, {
    method: "POST",
    body: { text: "run it" },
  });
  const finished = await events.waitFor(
    (event) =>
      (event.type === "tool.completed" || event.type === "tool.failed") &&
      event.callId === "call_1",
  );
  events.close();
  if (finished.type === "tool.completed")
    return { result: finished.result, isError: false, workspace: harness.workspace };
  if (finished.type === "tool.failed")
    return { result: finished.error, isError: true, workspace: harness.workspace };
  throw new Error("Expected the command tool to finish");
}

it("runs a real Windows command through WSL interop", async ({ skip }) => {
  if (unavailable) skip(unavailable);
  const { result, isError } = await runCommand({
    command: "ver",
    environment: "windows",
  });
  expect(isError).toBe(false);
  expect(result).toContain("exit code: 0");
  expect(result).toMatch(/Microsoft Windows/);
  expect(result).not.toContain("\uFFFD");
});

it("returns Chinese command output without mojibake", async ({ skip }) => {
  if (unavailable) skip(unavailable);
  const { result } = await runCommand({
    command: "echo 中文测试",
    environment: "windows",
  });
  expect(result).toContain("中文测试");
  expect(result).not.toContain("\uFFFD");
});

it("converts a workspace on a Windows drive to its Windows path", async ({ skip }) => {
  if (unavailable) skip(unavailable);
  const workspace = await mkdtemp(join(windowsDir, "prism-windows-"));
  created.push(workspace);
  const { result } = await runCommand(
    { command: "cd", environment: "windows" },
    { workspace },
  );
  expect(result).toContain("exit code: 0");
  expect(result).toMatch(/[a-z]:\\/i);
  expect(result).toContain(basename(workspace));
});

it("runs inside a WSL workspace through the Windows side of the share", async ({
  skip,
}) => {
  if (unavailable) skip(unavailable);
  const { result } = await runCommand(
    { command: "type probe.txt", environment: "windows" },
    {
      prepare: async (workspace) => {
        await writeFile(join(workspace, "probe.txt"), "wsl-workspace-probe");
      },
    },
  );
  expect(result).toContain("exit code: 0");
  expect(result).toContain("wsl-workspace-probe");
  expect(result).not.toContain("UNC");
});

it("kills the Windows process tree when the command times out", async ({ skip }) => {
  if (unavailable) skip(unavailable);
  const { result } = await runCommand({
    command: "ping -n 6 127.0.0.1",
    environment: "windows",
    timeoutMs: 300,
  });
  expect(result).toContain("timed out after 300ms");

  // The ping outlives the timeout only if taskkill missed the shell's children.
  const survivors = await runCommand({
    command: 'tasklist /nh /fi "IMAGENAME eq PING.EXE"',
    environment: "windows",
  });
  expect(survivors.result).not.toContain("PING.EXE");
});

it("refuses a command with line breaks instead of running half of it", async ({
  skip,
}) => {
  if (unavailable) skip(unavailable);
  const { result, isError } = await runCommand({
    command: "echo one\necho two",
    environment: "windows",
  });
  expect(isError).toBe(true);
  expect(result).toContain("one cmd.exe command line");
  expect(result).not.toContain("exit code: 0");
});

it("reports an explicit error when WSL interop is unavailable", async () => {
  const path = process.env.PATH;
  const harness = await startTestKernel({
    answers: [
      {
        toolCalls: [
          {
            id: "call_1",
            name: "run_command",
            arguments: JSON.stringify({ command: "ver", environment: "windows" }),
          },
        ],
      },
      { text: ["Done."] },
    ],
  });
  harnesses.push(harness);
  const events = await connectEvents(`${harness.kernel.url}/events`);
  const session = await createSession(harness.kernel.url, harness.workspace);
  process.env.PATH = "/nonexistent";
  try {
    await api(harness.kernel.url, `/sessions/${session.id}/messages`, {
      method: "POST",
      body: { text: "check the windows version" },
    });
    const failed = await events.waitFor(
      (event) => event.type === "tool.failed" && event.callId === "call_1",
    );
    if (failed.type !== "tool.failed") throw new Error("Expected a failed tool");
    expect(failed.error).toMatch(/interop/i);
    expect(failed.error).not.toContain("Microsoft Windows");
  } finally {
    process.env.PATH = path;
    events.close();
  }
});
