import type { EvidenceCapture } from "../../src/browser/evidence.ts";
import type { BrowserSession } from "../../src/browser/session.ts";
import type { ActCommand, Reply } from "../../src/cli/protocol.ts";
import { mkdtemp, rm } from "node:fs/promises";
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
  const capture = {
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
        { id: "e1", kind: "click", label: "Choose", node: 1 },
        { id: "e2", kind: "fill", label: "Name", node: 2 },
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
  } satisfies EvidenceCapture;
  const browser = {
    samePage: vi.fn(async () => true),
    fresh: vi.fn(async () => true),
    act: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
  const manager = new Sessions(directory, {
    connect: async () => ({ client: { send: vi.fn() }, close: async () => {} }),
    open: async () => browser as unknown as BrowserSession,
    capture: async () => structuredClone(capture),
    read: async () => structuredClone(capture),
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
  return { directory, capture, browser, manager, command, data };
}
function receipt(reply: Reply) {
  return (
    reply.data as { receipt: { outcome: string; code: string }; replayed: boolean }
  ).receipt;
}

describe("observation and execution contracts", () => {
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
    expect(receipt(await manager.handle(command)).outcome).toBe("unknown");
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
