import type { AddressInfo } from "node:net";
import type { AgentDependencies, JudgeVerdict } from "../src/agent.ts";
import type { BrowserConnection } from "../src/browser/connect.ts";
import type { BrowserSession } from "../src/browser/session.ts";
import type { Decision, HistoryEntry, Snapshot } from "../src/types.ts";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";

import { createServer } from "node:http";

import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent } from "../src/agent.ts";
import { connectBrowser, parseBrowserUrl } from "../src/browser/connect.ts";
import { openBrowserSession } from "../src/browser/session.ts";

const enabled = process.env.PRISM_IT_CHROME === "1";
const fixture = new URL("../fixtures/regression/index.html", import.meta.url);

describe.runIf(enabled)("browser regression", () => {
  let server: ReturnType<typeof createServer>;
  let connection: BrowserConnection;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(readFileSync(fixture));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    const endpoint = process.env.PRISM_IT_BROWSER_URL;
    connection = await connectBrowser(
      endpoint === undefined ? {} : parseBrowserUrl(endpoint),
    );
  }, 30_000);

  afterAll(async () => {
    await connection?.close();
    await new Promise<void>((resolve, reject) =>
      server?.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function openFixture(): Promise<BrowserSession> {
    return openBrowserSession({ url: baseUrl, client: connection.client });
  }

  it("fills, selects, clicks, records, and verifies a goal end to end", async () => {
    const session = await openFixture();
    const recordDir = mkdtempSync(join(tmpdir(), "prism-regression-"));
    try {
      const result = await runAgent({
        session,
        goal: "Register Ada with the blue color and submit the form.",
        dependencies: scriptedDependencies(),
        recordDir,
        judgeVision: false,
      });

      expect(result.status).toBe("done");
      expect(result.steps.map((step) => step.kind)).toEqual([
        "fill",
        "select",
        "click",
      ]);
      expect(result.steps[0]!.text).toBe("Ada");
      expect(result.steps[2]!.page_changed).toBe(true);

      const final = JSON.parse(readFileSync(join(recordDir, "final.json"), "utf8"));
      expect(final.status).toBe("done");
      expect(final.steps).toBe(3);

      const steps = readFileSync(join(recordDir, "steps.jsonl"), "utf8")
        .trim()
        .split("\n");
      expect(steps).toHaveLength(3);

      // Screenshots are best-effort: background tabs can throttle rendering, so
      // only the initial frame is guaranteed; steps.jsonl is always complete.
      const screenshots = readdirSync(recordDir).filter((name) =>
        name.endsWith(".jpg"),
      );
      expect(screenshots).toContain("000000.jpg");
      expect(screenshots.length).toBeLessThanOrEqual(4);
    } finally {
      await session.close();
      rmSync(recordDir, { recursive: true, force: true });
    }
  }, 60_000);

  it("re-observes instead of acting on a stale decision", async () => {
    const session = await openFixture();
    try {
      const base = scriptedDependencies();
      let chosen = 0;
      const dependencies: AgentDependencies = {
        ...base,
        choose: async (input) => {
          const decision = await base.choose(input);
          chosen += 1;
          if (chosen === 1) {
            // Mutate the page behind the decision so the freshness guard must reject it.
            await session.call("Runtime.evaluate", {
              expression: "document.getElementById('name').value = 'stale'",
              returnByValue: true,
            });
          }
          return decision;
        },
      };

      const result = await runAgent({
        session,
        goal: "Register Ada with the blue color and submit the form.",
        dependencies,
        maxSteps: 8,
      });

      expect(chosen).toBeGreaterThan(3);
      expect(result.steps.map((step) => step.kind)).toEqual([
        "fill",
        "select",
        "click",
      ]);
      expect(result.status).toBe("done");
    } finally {
      await session.close();
    }
  }, 60_000);
});

function scriptedDependencies(): AgentDependencies {
  const dependencies: AgentDependencies = {
    choose: async ({ snapshot, history }) => {
      if (history.length === 0) return decide(snapshot, "fill", "Name");
      if (history.length === 1) return decide(snapshot, "select", "Blue");
      if (history.length === 2) return decide(snapshot, "click", "Submit");
      return terminal("DONE");
    },
    fieldText: async () => ({
      text: "Ada",
      model: "scripted",
      usage: {},
      latencyMs: 0,
    }),
    judge: async ({ snapshot }): Promise<JudgeVerdict> => {
      const satisfied = snapshot.text.includes("Hello, Ada! Color: blue");
      return {
        satisfied,
        reason: satisfied
          ? "The confirmation text is visible."
          : "Missing confirmation.",
        model: "scripted",
      };
    },
  };
  return dependencies;
}

function decide(
  snapshot: Snapshot,
  kind: HistoryEntry["kind"],
  label: string,
): Decision {
  const action = snapshot.actions.find(
    (candidate) => candidate.kind === kind && candidate.label.includes(label),
  );
  if (action === undefined)
    throw new Error(`Scripted action not found: ${kind} ${label}`);
  return {
    choice: action.id,
    operation: kind === "fill" ? "TYPE_TEXT" : kind.toUpperCase(),
    target: null,
    confidence: 1,
    probabilities: { [action.id]: 1 },
    operationProbabilities: {},
    targetProbabilities: {},
    targetConfidence: null,
    rawAnswers: {},
    model: "scripted",
    usage: {},
    latencyMs: 0,
    request: {},
  };
}

function terminal(choice: "DONE" | "BLOCKED"): Decision {
  return {
    choice,
    operation: choice,
    target: null,
    confidence: 1,
    probabilities: { [choice]: 1 },
    operationProbabilities: {},
    targetProbabilities: {},
    targetConfidence: null,
    rawAnswers: {},
    model: "scripted",
    usage: {},
    latencyMs: 0,
    request: {},
  };
}
