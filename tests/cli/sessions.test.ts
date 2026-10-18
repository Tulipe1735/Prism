import type { EvidenceCapture } from "../../src/browser/evidence.ts";
import type { BrowserSession } from "../../src/browser/session.ts";
import type { ActCommand, Reply } from "../../src/cli/protocol.ts";
import { Buffer } from "node:buffer";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StalePageError } from "../../src/browser/session.ts";
import { readReceipt } from "../../src/cli/receipts.ts";
import { Sessions } from "../../src/cli/sessions.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "prism-contract-"));
  directories.push(directory);
  const capture: EvidenceCapture = {
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
    status: "",
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
  const browser = {
    samePage: vi.fn(async () => true),
    fresh: vi.fn(async () => true),
    act: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const capturePage = vi.fn(async () => structuredClone(capture));
  const manager = new Sessions(directory, {
    connect: async () => ({ client: { send: vi.fn() }, close: async () => {} }),
    open: async () => browser as unknown as BrowserSession,
    capture: capturePage,
    read: async (_session, action) => ({
      ...structuredClone(capture),
      current: structuredClone(
        capture.snapshot.actions.find((item) => item.id === action.id)!,
      ),
    }),
  });
  const opened = await manager.handle({
    command: "open",
    url: "https://example.com/",
    browser_url: "http://localhost:9222",
  });
  const session = (opened.data as { session: string }).session;
  const observed = await manager.handle({
    command: "observe",
    session,
    scope: "relations",
  });
  const data = observed.data as {
    observation: string;
    evidence: string;
    targets: { ref: string }[];
  };
  const command: ActCommand = {
    command: "act",
    session,
    observation: data.observation,
    evidence: data.evidence,
    target: data.targets[0]!.ref,
    operation: "click",
    request_id: "r1",
  };
  return { directory, capture, capturePage, browser, manager, command, data };
}
function receipt(reply: Reply) {
  return (
    reply.data as { receipt: { outcome: string; code: string }; replayed: boolean }
  ).receipt;
}

describe("observation and execution contracts", () => {
  it("returns explicit false and empty states without duplicate identity or context", async () => {
    const { manager, command, capture } = await setup();
    Object.assign(capture.snapshot.actions[0]!.control!, {
      role: "checkbox",
      checked: false,
      value: "on",
    });
    const reply = await manager.handle({
      command: "observe",
      session: command.session,
      scope: "local",
    });
    expect(reply).toMatchObject({
      data: {
        targets: [
          {
            description: 'checkbox "Choose"',
            state: { checked: false, value: "on" },
            context: { local: "Plan" },
          },
          { description: 'textbox "Name"', state: { value: "" } },
        ],
      },
    });
    const targets = (reply.data as { targets: object[] }).targets;
    for (const target of targets) {
      expect(target).not.toHaveProperty("label");
      expect(target).not.toHaveProperty("role");
    }
  });
  it("rejects changed current state even when a freshness check accepts the node", async () => {
    const { manager, command, capture, browser } = await setup();
    Object.assign(capture.snapshot.actions[0]!.control!, {
      role: "checkbox",
      checked: false,
    });
    const observed = await manager.handle({
      command: "observe",
      session: command.session,
      scope: "local",
    });
    const view = observed.data as typeof command & { targets: { ref: string }[] };
    capture.snapshot.actions[0]!.control!.checked = true;
    const reply = await manager.handle({
      ...command,
      observation: view.observation,
      evidence: view.evidence,
      target: view.targets[0]!.ref,
    });
    expect(receipt(reply)).toMatchObject({
      outcome: "not_executed",
      code: "EVIDENCE_CHANGED",
    });
    expect(browser.act).not.toHaveBeenCalled();
    expect(reply.data).not.toHaveProperty("post_observation");
  });
  it("offers current post-observation refs and never returns them on replay", async () => {
    const { manager, command, capturePage, browser } = await setup();
    const reply = await manager.handle(command);
    const post = (
      reply.data as {
        post_observation: {
          status: string;
          data: typeof command & { targets: { ref: string }[] };
        };
      }
    ).post_observation;
    expect(post.status).toBe("captured");
    expect(post.data.observation).not.toBe(command.observation);
    expect(post.data).toHaveProperty("state");
    expect(await manager.handle(command)).toMatchObject({ data: { replayed: true } });
    expect((await manager.handle(command)).data).not.toHaveProperty("post_observation");
    expect(capturePage).toHaveBeenCalledTimes(2);
    expect(
      receipt(
        await manager.handle({
          ...command,
          request_id: "next",
          observation: post.data.observation,
          evidence: post.data.evidence,
          target: post.data.targets[0]!.ref,
        }),
      ).outcome,
    ).toBe("executed");
    expect(browser.act).toHaveBeenCalledTimes(2);
  });
  it("keeps an acknowledged receipt when the post-observation fails", async () => {
    const { manager, command, capturePage, directory, browser } = await setup();
    capturePage.mockRejectedValueOnce(new Error("observation disconnected"));
    const reply = await manager.handle(command);
    expect(reply).toMatchObject({
      ok: true,
      data: {
        receipt: { outcome: "executed" },
        post_observation: {
          status: "failed",
          error: { message: "observation disconnected" },
        },
      },
    });
    expect(
      (await readReceipt(directory, command.session, command.request_id))?.outcome,
    ).toBe("executed");
    expect((await manager.handle(command)).data).not.toHaveProperty("post_observation");
    expect(browser.act).toHaveBeenCalledTimes(1);
    expect(
      receipt(await manager.handle({ ...command, request_id: "expired" })).code,
    ).toBe("OBSERVATION_EXPIRED");
  });
  it("records private phase metrics without adding them to public observations", async () => {
    const { manager, command, directory } = await setup();
    const reply = await manager.handle(command);
    expect(reply.data).not.toHaveProperty("metrics");
    const files = await readdir(join(directory, "events"));
    const events = (await readFile(join(directory, "events", files[0]!), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const observed = events.find((event) => event.type === "observed");
    expect(observed.metrics.output_bytes).toBe(
      Buffer.byteLength(JSON.stringify(observed.data)),
    );
    const event = events.find((event) => event.type === "action");
    for (const value of Object.values(event.metrics))
      expect(value).toEqual(expect.any(Number));
    expect(event.metrics.total_ms).toBeGreaterThanOrEqual(event.metrics.execution_ms);
  });
  it("serializes concurrent duplicate requests and rejects reused ids for different decisions", async () => {
    const { manager, command, browser } = await setup();
    const replies = await Promise.all([
      manager.handle(command),
      manager.handle(command),
    ]);
    expect(replies.every((reply) => receipt(reply).outcome === "executed")).toBe(true);
    expect(browser.act).toHaveBeenCalledTimes(1);
    expect(await manager.handle({ ...command, operation: "fill" })).toMatchObject({
      ok: false,
      error: { code: "REQUEST_ID_CONFLICT" },
    });
    expect(await manager.handle({ ...command, request_id: "new" })).toMatchObject({
      ok: false,
      error: { code: "OBSERVATION_EXPIRED" },
    });
  });
  it("checks target membership, operations and target-specific evidence before input", async () => {
    const { manager, command, browser, data } = await setup();
    const scoped = await manager.handle({
      command: "context",
      session: command.session,
      observation: command.observation,
      target: command.target,
      scope: "structural",
    });
    const evidence = (scoped.data as { evidence: string }).evidence;
    expect(await manager.handle({ ...command, target: "o_unknown:e1" })).toMatchObject({
      error: { code: "TARGET_NOT_OFFERED" },
    });
    expect(
      await manager.handle({ ...command, request_id: "r2", operation: "fill" }),
    ).toMatchObject({ error: { code: "OPERATION_NOT_OFFERED" } });
    expect(
      await manager.handle({
        ...command,
        request_id: "r3",
        target: data.targets[1]!.ref,
        operation: "fill",
        value: "hello",
        evidence,
      }),
    ).toMatchObject({ error: { code: "EVIDENCE_NOT_OFFERED" } });
    expect(browser.act).not.toHaveBeenCalled();
  });
  it("rejects changed displayed relation evidence even when the control remains fresh", async () => {
    const { manager, command, browser, capture } = await setup();
    capture.relations["1"]![0]!.text = "Beta";
    const reply = await manager.handle(command);
    expect(receipt(reply)).toMatchObject({
      outcome: "not_executed",
      code: "EVIDENCE_CHANGED",
    });
    expect(browser.act).not.toHaveBeenCalled();
  });
  it("does not inspect undisplayed relations when local evidence is used", async () => {
    const { manager, command, browser, capture } = await setup();
    const observed = await manager.handle({
      command: "observe",
      session: command.session,
      scope: "local",
    });
    const data = observed.data as {
      observation: string;
      evidence: string;
      targets: { ref: string }[];
    };
    capture.relations["1"]![0]!.text = "Beta";
    const reply = await manager.handle({
      ...command,
      observation: data.observation,
      evidence: data.evidence,
      target: data.targets[0]!.ref,
    });
    expect(receipt(reply).outcome).toBe("executed");
    expect(browser.act).toHaveBeenCalledTimes(1);
  });
  it("checks displayed group orientation before dispatching input", async () => {
    const { manager, command, browser, capture } = await setup();
    const relation: EvidenceCapture["relations"][string][number] =
      capture.relations["1"]![0]!;
    relation.layout = "vertical";
    const reply = await manager.handle(command);
    expect(receipt(reply)).toMatchObject({
      outcome: "not_executed",
      code: "EVIDENCE_CHANGED",
    });
    expect(browser.act).not.toHaveBeenCalled();
  });
  it("writes the pending receipt before dispatch, and never repeats uncertain input", async () => {
    const { manager, command, browser, directory } = await setup();
    browser.act.mockImplementation(async () => {
      expect(
        (await readReceipt(directory, command.session, command.request_id))?.outcome,
      ).toBe("unknown");
      throw new Error("CDP disconnected after input");
    });
    const uncertain = await manager.handle(command);
    expect(uncertain.ok).toBe(false);
    expect(receipt(uncertain).outcome).toBe("unknown");
    expect(uncertain.data).toMatchObject({ post_observation: { status: "captured" } });
    expect(receipt(await manager.handle(command)).outcome).toBe("unknown");
    await manager.closeAll();
    expect(receipt(await manager.handle(command)).outcome).toBe("unknown");
    expect(browser.act).toHaveBeenCalledTimes(1);
  });
  it("distinguishes executor rejection before input from uncertain execution", async () => {
    const { manager, command, browser } = await setup();
    browser.act.mockRejectedValueOnce(new StalePageError("stale before input"));
    expect(receipt(await manager.handle(command))).toMatchObject({
      outcome: "not_executed",
      code: "TARGET_CHANGED",
    });
  });
  it("refuses document replacement before dispatch and expires old observations", async () => {
    const { manager, command, browser } = await setup();
    browser.samePage.mockResolvedValue(false);
    expect(receipt(await manager.handle(command))).toMatchObject({
      outcome: "not_executed",
      code: "DOCUMENT_CHANGED",
    });
    expect(browser.act).not.toHaveBeenCalled();
  });
  it("retains durable receipts after closing its owned tab", async () => {
    const { manager, command, browser } = await setup();
    await manager.handle(command);
    await manager.handle({ command: "close", session: command.session });
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(
      await manager.handle({
        command: "receipt",
        session: command.session,
        request_id: command.request_id,
      }),
    ).toMatchObject({ ok: true });
    expect(receipt(await manager.handle(command)).outcome).toBe("executed");
    expect(browser.act).toHaveBeenCalledTimes(1);
  });
});
