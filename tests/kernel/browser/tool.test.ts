import type {
  EngineHandle,
  EngineOptions,
} from "../../../src/kernel/browser/engine.ts";
import type {
  EvidenceCapture,
  TargetCapture,
} from "../../../src/kernel/browser/evidence.ts";
import type { BrowserPage } from "../../../src/kernel/browser/session.ts";
import type { BrowserToolDependencies } from "../../../src/kernel/browser/tool.ts";
import type { SnapshotAction } from "../../../src/shared/types.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserTool } from "../../../src/kernel/browser/tool.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function fixture(): EvidenceCapture {
  return {
    snapshot: {
      url: "https://example.com/",
      title: "public page",
      w: 1120,
      h: 780,
      text: "",
      scroll: { y: 0, height: 780 },
      marker: [1, "https://example.com/"],
      page_key: "page",
      omitted_actions: 0,
      actions: [
        {
          id: "e1",
          kind: "click",
          label: "Choose",
          node: 1,
          control: { name: "Choose", role: "button", disabled: false, readonly: false },
        },
        {
          id: "e2",
          kind: "fill",
          label: "Name",
          node: 2,
          control: {
            name: "Name",
            role: "textbox",
            disabled: false,
            readonly: false,
            value: "",
          },
        },
        {
          id: "e3",
          kind: "select",
          value: "us",
          label: "Region → America",
          node: 3,
          option_label: "America",
          control: {
            name: "Region",
            role: "combobox",
            disabled: false,
            readonly: false,
            value: "eu",
            selected_options: [{ value: "eu", label: "Europe" }],
            truncated: true,
          },
        },
      ],
      guards: {},
      fingerprint: "test",
    },
    contexts: {
      "1": {
        context: "Plan",
        container: "card",
        nearby_text: "Plan",
        section: "Alpha",
      },
      "2": {
        context: "Name",
        container: "card",
        nearby_text: "Name",
        section: "Alpha",
      },
    },
    relations: { "1": [{ tag: 1, text: "Alpha", scope: "section" }] },
    state: {
      source: "dom",
      observed_at: "2026-10-11T00:00:00.000Z",
      controls: [],
      messages: [],
      coverage: {
        scope: "viewport",
        controls: { total: 0, returned: 0, omitted: 0 },
        messages: { total: 0, returned: 0, omitted: 0 },
        truncated: false,
      },
    },
  };
}

interface Harness {
  directory: string;
  tool: BrowserTool;
  deps: BrowserToolDependencies;
  page: {
    samePage: ReturnType<typeof vi.fn>;
    fresh: ReturnType<typeof vi.fn>;
    act: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  capture: EvidenceCapture;
  openSession: ReturnType<typeof vi.fn>;
}

async function harness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "prism-kernel-browser-"));
  directories.push(directory);
  const capture = fixture();
  const page = {
    samePage: vi.fn(async () => true),
    fresh: vi.fn(async () => true),
    act: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const engine = {
    name: "chromium",
    browser: {} as EngineHandle["browser"],
    context: {} as EngineHandle["context"],
    close: vi.fn(async () => {}),
  } as unknown as EngineHandle;
  const openSession = vi.fn(async () => page as unknown as BrowserPage);
  const deps: BrowserToolDependencies = {
    openEngine: async (_options: EngineOptions) => engine,
    openSession,
    capture: async () => structuredClone(capture),
    read: async (
      _session: BrowserPage,
      action: SnapshotAction,
    ): Promise<TargetCapture> => ({
      contexts: structuredClone(capture.contexts),
      relations: structuredClone(capture.relations),
      current: structuredClone(
        capture.snapshot.actions.find((item) => item.id === action.id)!,
      ),
    }),
  };
  const tool = new BrowserTool({ directory }, deps);
  return { directory, tool, deps, page, capture, openSession };
}

describe("browser tool observation references", () => {
  it("executes a fill and expires the observation that produced its target", async () => {
    const { tool, page } = await harness();
    const { session } = await tool.open({ url: "https://example.com/" });
    const view = await tool.observe(session, "local");
    const target = view.targets.find((item) => item.operation === "fill")!;
    const command = {
      observation: view.observation,
      target: target.ref,
      evidence: view.evidence,
      operation: "fill" as const,
    };
    const result = await tool.act(session, {
      ...command,
      value: "Ada",
      request_id: "fill1",
    });
    expect(result.receipt.outcome).toBe("executed");
    expect(result.replayed).toBe(false);
    expect(page.act).toHaveBeenCalledTimes(1);
    expect(page.act).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "fill" }),
      expect.anything(),
      "Ada",
    );
    expect(result.post_observation).toMatchObject({ status: "captured" });
    const expired = await tool.act(session, {
      ...command,
      value: "Bad",
      request_id: "fill2",
    });
    expect(expired.receipt).toMatchObject({
      outcome: "not_executed",
      code: "OBSERVATION_EXPIRED",
    });
    expect(page.act).toHaveBeenCalledTimes(1);
  });

  it("replays the durable receipt for the same request and refuses a conflicting one", async () => {
    const { directory, tool, deps, page } = await harness();
    const { session } = await tool.open({ url: "https://example.com/" });
    const view = await tool.observe(session, "local");
    const target = view.targets.find((item) => item.operation === "click")!;
    const command = {
      observation: view.observation,
      target: target.ref,
      evidence: view.evidence,
      operation: "click" as const,
      request_id: "click1",
    };
    const first = await tool.act(session, command);
    expect(first.receipt.outcome).toBe("executed");
    const replay = await tool.act(session, command);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay).not.toHaveProperty("post_observation");
    expect(page.act).toHaveBeenCalledTimes(1);
    await expect(
      tool.act(session, { ...command, target: view.targets[1]!.ref }),
    ).rejects.toMatchObject({ code: "REQUEST_ID_CONFLICT" });
    await tool.close(session);
    const restarted = new BrowserTool({ directory }, deps);
    expect(await restarted.receipt(session, "click1")).toEqual(first.receipt);
    const afterClose = await restarted.act(session, command);
    expect(afterClose).toMatchObject({ replayed: true, receipt: first.receipt });
  });

  it("records an unknown outcome when input may have reached the browser", async () => {
    const { tool, page } = await harness();
    const { session } = await tool.open({ url: "https://example.com/" });
    const view = await tool.observe(session, "local");
    const target = view.targets.find((item) => item.operation === "click")!;
    page.act.mockRejectedValueOnce(new Error("Page crashed while dispatching input"));
    const result = await tool.act(session, {
      observation: view.observation,
      target: target.ref,
      evidence: view.evidence,
      operation: "click",
      request_id: "uncertain",
    });
    expect(result.receipt).toMatchObject({
      outcome: "unknown",
      stage: "execution",
      code: "OUTCOME_UNKNOWN",
    });
    expect(result.post_observation).toMatchObject({ status: "captured" });
    expect(await tool.receipt(session, "uncertain")).toEqual(result.receipt);
  });

  it("rejects a target whose identity or state changed before input", async () => {
    const { tool, page } = await harness();
    const { session } = await tool.open({ url: "https://example.com/" });
    const view = await tool.observe(session, "local");
    const target = view.targets.find((item) => item.operation === "click")!;
    page.fresh.mockResolvedValueOnce(false);
    const result = await tool.act(session, {
      observation: view.observation,
      target: target.ref,
      evidence: view.evidence,
      operation: "click",
      request_id: "changed",
    });
    expect(result.receipt).toMatchObject({
      outcome: "not_executed",
      code: "TARGET_CHANGED",
    });
    expect(page.act).not.toHaveBeenCalled();
  });

  it("refuses changed evidence and truncated selection state before input", async () => {
    const { tool, capture, page } = await harness();
    const { session } = await tool.open({ url: "https://example.com/" });
    const view = await tool.observe(session, "local");
    const click = view.targets.find((item) => item.operation === "click")!;
    capture.contexts["1"]!.context = "Changed";
    const changed = await tool.act(session, {
      observation: view.observation,
      target: click.ref,
      evidence: view.evidence,
      operation: "click",
      request_id: "changed-evidence",
    });
    expect(changed.receipt).toMatchObject({
      outcome: "not_executed",
      code: "EVIDENCE_CHANGED",
    });
    expect(page.act).not.toHaveBeenCalled();
    const again = await tool.observe(session, "local");
    const select = again.targets.find((item) => item.operation === "select")!;
    expect(select.state.truncated).toBe(true);
    const truncated = await tool.act(session, {
      observation: again.observation,
      target: select.ref,
      evidence: again.evidence,
      operation: "select",
      request_id: "truncated",
    });
    expect(truncated.receipt).toMatchObject({
      outcome: "not_executed",
      code: "EVIDENCE_TRUNCATED",
    });
    expect(page.act).not.toHaveBeenCalled();
  });

  it("requires a value for fill and refuses values for other operations", async () => {
    const { tool, page } = await harness();
    const { session } = await tool.open({ url: "https://example.com/" });
    const view = await tool.observe(session, "local");
    const fill = view.targets.find((item) => item.operation === "fill")!;
    const click = view.targets.find((item) => item.operation === "click")!;
    const missing = await tool.act(session, {
      observation: view.observation,
      target: fill.ref,
      evidence: view.evidence,
      operation: "fill",
      request_id: "missing-value",
    });
    expect(missing.receipt).toMatchObject({
      outcome: "not_executed",
      code: "VALUE_REQUIRED",
    });
    const unexpected = await tool.act(session, {
      observation: view.observation,
      target: click.ref,
      evidence: view.evidence,
      operation: "click",
      value: "text",
      request_id: "unexpected-value",
    });
    expect(unexpected.receipt).toMatchObject({
      outcome: "not_executed",
      code: "UNEXPECTED_VALUE",
    });
    expect(page.act).not.toHaveBeenCalled();
  });

  it("accepts relation evidence captured for one target as the action evidence", async () => {
    const { tool, capture } = await harness();
    const { session } = await tool.open({ url: "https://example.com/" });
    const view = await tool.observe(session, "relations");
    const target = view.targets.find((item) => item.operation === "click")!;
    const context = await tool.context(session, {
      observation: view.observation,
      target: target.ref,
    });
    expect(context.relations!.map((entry) => entry.text)).toContain("Alpha");
    const stale = await tool.context(session, {
      observation: view.observation,
      target: target.ref,
    });
    capture.relations["1"] = [{ tag: 1, text: "Beta", scope: "section" }];
    const refused = await tool.act(session, {
      observation: view.observation,
      target: target.ref,
      evidence: stale.evidence,
      operation: "click",
      request_id: "stale-relation",
    });
    expect(refused.receipt).toMatchObject({
      outcome: "not_executed",
      code: "EVIDENCE_CHANGED",
    });
    const again = await tool.observe(session, "relations");
    const current = again.targets.find((item) => item.operation === "click")!;
    const fresh = await tool.context(session, {
      observation: again.observation,
      target: current.ref,
    });
    expect(fresh.relations!.map((entry) => entry.text)).toContain("Beta");
    const executed = await tool.act(session, {
      observation: again.observation,
      target: current.ref,
      evidence: fresh.evidence,
      operation: "click",
      request_id: "fresh-relation",
    });
    expect(executed.receipt.outcome).toBe("executed");
  });
});
