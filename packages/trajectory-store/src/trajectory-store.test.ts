import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type BrowserBaselineRecord,
  type RepairRequest,
  RUN_EVENT_SCHEMA_VERSION,
  type RunEvent,
  type RunSnapshot,
} from "@prism/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileTrajectoryStore, projectRunEvents, RunIntegrityError } from "./index";

const runId = "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0";
const createdEventId = "28bb152c-1873-4d6f-81e8-efc154bb9ad8";
const queuedEventId = "50eea2be-7d3a-449c-aae2-4f4f58ae174f";
const terminalEventId = "98a175b4-c6e2-4cd5-8d09-04ed730f16bc";
const recordedAt = "2026-07-31T04:00:00.000Z";

const request: RepairRequest = {
  schemaVersion: "prism.repair-request/v1",
  prompt: "  Make the primary Save button clearly rounded instead of square.  ",
  workspace: {
    kind: "local",
    path: "/workspaces/prism-fixture",
    displayName: "prism-fixture",
  },
  viewport: {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
  },
};

let dataDirectory: string;
let store: FileTrajectoryStore;

beforeEach(async () => {
  dataDirectory = await mkdtemp(join(tmpdir(), "prism-trajectory-"));
  const eventIds = [createdEventId, queuedEventId];

  store = new FileTrajectoryStore({
    dataDirectory,
    clock: () => new Date(recordedAt),
    runIdFactory: () => runId,
    eventIdFactory: () => eventIds.shift() ?? terminalEventId,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dataDirectory, { recursive: true, force: true });
});

describe("FileTrajectoryStore", () => {
  it("creates canonical state and reopens the same Run from disk", async () => {
    const created = await store.createRun(request);
    const expectedArtifactBytes = Buffer.from(`${JSON.stringify(request)}\n`, "utf8");

    expect(created.manifest.request.prompt).toBe(request.prompt);
    expect(created.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, "run.created"],
      [2, "run.queued"],
    ]);
    expect(projectRunEvents(created.manifest, created.events)).toEqual(
      created.snapshot,
    );
    expect(await store.readArtifact(created.manifest.requestArtifact)).toEqual(
      expectedArtifactBytes,
    );

    const reopened = new FileTrajectoryStore({ dataDirectory });
    expect(await reopened.loadRun(runId)).toEqual(created);
  });

  it("projects workspace evidence and verifies its content-addressed artifact", async () => {
    await store.createRun(request);
    const evidence = {
      schemaVersion: "prism.workspace-evidence/v1",
      requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
      runId,
      operation: "inspect",
      status: "succeeded",
      reasonCode: null,
      summary: "Read 1 file and discovered 1 file.",
      startedAt: recordedAt,
      finishedAt: recordedAt,
      details: {
        operation: "inspect",
        reads: [
          {
            path: "package.json",
            byteLength: 18,
            capturedSha256: "b".repeat(64),
            content: '{"name":"fixture"}',
            truncated: false,
            redactionCount: 0,
          },
        ],
        discoveredPaths: ["package.json"],
        discoveryTruncated: false,
      },
    } as const;
    const artifact = await store.writeArtifact(
      `${JSON.stringify(evidence)}\n`,
      "application/vnd.prism.workspace-evidence+json",
    );

    const snapshot = await store.appendEvent({
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: terminalEventId,
      runId,
      sequence: 3,
      recordedAt,
      correlationId: runId,
      causationEventId: queuedEventId,
      type: "workspace.evidence",
      payload: { evidence, artifact },
    });

    expect(snapshot).toMatchObject({
      lastSequence: 3,
      status: "queued",
      workspaceEvidence: [{ evidence: { operation: "inspect" }, artifact }],
    });
    expect((await store.loadRun(runId)).snapshot).toEqual(snapshot);
  });

  it("projects a brokered Browser Baseline and verifies every committed evidence artifact", async () => {
    await store.createRun(request);
    const screenshot = await store.writeArtifact(
      Buffer.from([137, 80, 78, 71]),
      "image/png",
    );
    const evidence = await store.writeArtifact(
      '{"source":"browser"}\n',
      "application/vnd.prism.browser-evidence+json",
    );
    const trace = await store.writeArtifact(Buffer.from("trace"), "application/zip");
    const baseline: BrowserBaselineRecord = {
      schemaVersion: "prism.browser-baseline/v1",
      baselineId: "f374f1ae-8ce2-432f-af52-c8973588bb0a",
      runId,
      buildIdentity: "fixture@5a6c2ab",
      route: "/settings/profile",
      browserVersion: "Chromium 142.0.0.0",
      viewport: request.viewport,
      devicePixelRatio: 1,
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
      targetIdentity: "role=button[name=Save]",
      observation: {
        observationId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
        url: "http://127.0.0.1:4173/settings/profile",
        viewport: request.viewport,
        pageStateHash: "b".repeat(64),
        screenshotHash: screenshot.hash,
      },
      screenshot,
      dom: evidence,
      accessibility: evidence,
      computed: evidence,
      console: evidence,
      network: evidence,
      trace,
      capturedAt: recordedAt,
      supplementalVisualJudgment: null,
    };

    const committed = await store.recordBrowserEffect(runId, async () => baseline);

    expect(committed).toEqual(baseline);
    expect((await store.loadRun(runId)).snapshot).toMatchObject({
      lastSequence: 3,
      browserBaselines: [{ baselineId: baseline.baselineId, screenshot }],
      artifacts: expect.arrayContaining([screenshot, evidence, trace]),
    });
  });

  it("validates before append, enforces the next sequence, and keeps the manifest immutable", async () => {
    await store.createRun(request);
    const manifestPath = join(dataDirectory, "runs", runId, "manifest.json");
    const manifestBefore = await readFile(manifestPath, "utf8");
    const terminalEvent: RunEvent = {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: terminalEventId,
      runId,
      sequence: 3,
      recordedAt,
      correlationId: runId,
      causationEventId: queuedEventId,
      type: "run.terminal-error",
      payload: { code: "storage_error", message: "The test storage stopped." },
    };

    const snapshot = await store.appendEvent(terminalEvent);
    expect(snapshot).toMatchObject({ status: "terminal_error", lastSequence: 3 });
    expect(await readFile(manifestPath, "utf8")).toBe(manifestBefore);
    await expect(store.appendEvent(terminalEvent)).rejects.toMatchObject({
      code: "corrupt_event",
    });
    await expect(
      store.appendEvent({
        ...terminalEvent,
        sequence: 4,
        payload: { message: "missing code" },
      }),
    ).rejects.toBeInstanceOf(RunIntegrityError);
  });

  it("reports an appended event as committed when only the snapshot cache write fails", async () => {
    await store.createRun(request);
    const snapshotWriter = vi
      .spyOn(
        FileTrajectoryStore.prototype as unknown as {
          writeSnapshot: (runDirectory: string, snapshot: RunSnapshot) => Promise<void>;
        },
        "writeSnapshot",
      )
      .mockRejectedValueOnce(new Error("snapshot cache unavailable"));
    const terminalEvent: RunEvent = {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: terminalEventId,
      runId,
      sequence: 3,
      recordedAt,
      correlationId: runId,
      causationEventId: queuedEventId,
      type: "run.terminal-error",
      payload: { code: "storage_error", message: "The journal commit is canonical." },
    };

    const snapshot = await store.appendEvent(terminalEvent);

    expect(snapshot).toMatchObject({ lastSequence: 3, status: "terminal_error" });
    expect(snapshotWriter).toHaveBeenCalledOnce();
    expect(
      await new FileTrajectoryStore({ dataDirectory }).loadRun(runId),
    ).toMatchObject({
      events: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }],
      snapshot: { lastSequence: 3, status: "terminal_error" },
    });
  });

  it("serializes append attempts across store instances in one Prism process", async () => {
    await store.createRun(request);
    const candidate: RunEvent = {
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: terminalEventId,
      runId,
      sequence: 3,
      recordedAt,
      correlationId: runId,
      causationEventId: queuedEventId,
      type: "run.terminal-error",
      payload: { code: "storage_error", message: "Only one append may commit." },
    };
    const firstStore = new FileTrajectoryStore({ dataDirectory });
    const secondStore = new FileTrajectoryStore({ dataDirectory });

    const results = await Promise.allSettled([
      firstStore.appendEvent(candidate),
      secondStore.appendEvent({
        ...candidate,
        eventId: "f374f1ae-8ce2-432f-af52-c8973588bb0a",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await store.loadRun(runId)).toMatchObject({
      events: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }],
      snapshot: { lastSequence: 3, status: "terminal_error" },
    });
  });

  it("rejects a corrupted or non-monotonic event journal", async () => {
    await store.createRun(request);
    const journalPath = join(dataDirectory, "runs", runId, "events.jsonl");
    const journal = await readFile(journalPath, "utf8");
    await writeFile(journalPath, journal.replace('"sequence":2', '"sequence":8'));

    const reopened = new FileTrajectoryStore({ dataDirectory });
    await expect(reopened.loadRun(runId)).rejects.toMatchObject({
      code: "corrupt_event",
    });
  });

  it("rejects blank or torn journal records instead of silently skipping them", async () => {
    await store.createRun(request);
    const journalPath = join(dataDirectory, "runs", runId, "events.jsonl");
    const journal = await readFile(journalPath, "utf8");
    const reopened = new FileTrajectoryStore({ dataDirectory });

    await writeFile(journalPath, journal.replace("\n{", "\n\n{"), "utf8");
    await expect(reopened.loadRun(runId)).rejects.toMatchObject({
      code: "corrupt_event",
    });

    await writeFile(journalPath, journal.trimEnd(), "utf8");
    await expect(reopened.loadRun(runId)).rejects.toMatchObject({
      code: "corrupt_event",
    });
  });

  it("rejects a complete journal suffix deletion when the cache witnessed a later sequence", async () => {
    await store.createRun(request);
    await store.appendEvent({
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: terminalEventId,
      runId,
      sequence: 3,
      recordedAt,
      correlationId: runId,
      causationEventId: queuedEventId,
      type: "run.terminal-error",
      payload: {
        code: "storage_error",
        message: "This complete record must not vanish.",
      },
    });
    const journalPath = join(dataDirectory, "runs", runId, "events.jsonl");
    const journal = await readFile(journalPath, "utf8");
    const records = journal.trimEnd().split("\n");
    await writeFile(journalPath, `${records.slice(0, -1).join("\n")}\n`, "utf8");

    await expect(
      new FileTrajectoryStore({ dataDirectory }).loadRun(runId),
    ).rejects.toMatchObject({
      code: "corrupt_event",
    });
  });

  it("rejects a manifest request that no longer matches its hashed artifact", async () => {
    await store.createRun(request);
    const manifestPath = join(dataDirectory, "runs", runId, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
      string,
      unknown
    >;

    await writeFile(
      manifestPath,
      `${JSON.stringify({
        ...manifest,
        request: { ...request, prompt: "A schema-valid but tampered prompt." },
      })}\n`,
      "utf8",
    );

    await expect(store.loadRun(runId)).rejects.toMatchObject({
      code: "corrupt_manifest",
    });
  });

  it("rejects artifact bytes that no longer match their address", async () => {
    const created = await store.createRun(request);
    const { hash } = created.manifest.requestArtifact;
    const artifactPath = join(
      dataDirectory,
      "artifacts",
      "sha256",
      hash.slice(0, 2),
      hash,
    );
    await writeFile(artifactPath, "tampered artifact", "utf8");

    const reopened = new FileTrajectoryStore({ dataDirectory });
    await expect(reopened.loadRun(runId)).rejects.toMatchObject({
      code: "corrupt_artifact",
    });
  });
});
