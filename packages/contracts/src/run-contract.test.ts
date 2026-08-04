import { describe, expect, it } from "vitest";

import {
  artifactRefSchema,
  browserActionProposalSchema,
  browserBaselineRecordSchema,
  runCreationSchema,
  runDossierResponseSchema,
  runEventSchema,
  runListSchema,
  runManifestSchema,
  runSnapshotSchema,
  workspaceEvidenceRecordSchema,
  workspaceRequestSchema,
} from "./index";

const request = {
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
} as const;

const artifact = {
  schemaVersion: "prism.artifact-ref/v1",
  algorithm: "sha256",
  hash: "a".repeat(64),
  byteLength: 192,
  mediaType: "application/vnd.prism.repair-request+json",
} as const;

const manifest = {
  schemaVersion: "prism.run-manifest/v1",
  runId: "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0",
  createdAt: "2026-07-31T04:00:00.000Z",
  request,
  requestArtifact: artifact,
} as const;

const createdEvent = {
  schemaVersion: "prism.run-event/v1",
  eventId: "28bb152c-1873-4d6f-81e8-efc154bb9ad8",
  runId: manifest.runId,
  sequence: 1,
  recordedAt: manifest.createdAt,
  correlationId: manifest.runId,
  causationEventId: null,
  type: "run.created",
  payload: { requestArtifact: artifact },
} as const;

const queuedEvent = {
  ...createdEvent,
  eventId: "50eea2be-7d3a-449c-aae2-4f4f58ae174f",
  sequence: 2,
  causationEventId: createdEvent.eventId,
  type: "run.queued",
  payload: {},
} as const;

const snapshot = {
  schemaVersion: "prism.run-snapshot/v1",
  runId: manifest.runId,
  title: "Make the primary Save button clearly rounded instead of square.",
  status: "queued",
  createdAt: manifest.createdAt,
  updatedAt: manifest.createdAt,
  lastSequence: 2,
  artifacts: [artifact],
  terminalError: null,
} as const;

describe("Durable Run contracts", () => {
  it("preserves the original prompt in an immutable versioned manifest", () => {
    const parsed = runManifestSchema.parse(manifest);

    expect(parsed.request.prompt).toBe(request.prompt);
    expect(parsed.schemaVersion).toBe("prism.run-manifest/v1");
  });

  it("accepts content-addressed artifact references and rejects unsafe digests", () => {
    expect(artifactRefSchema.parse(artifact)).toEqual(artifact);
    expect(
      artifactRefSchema.safeParse({ ...artifact, hash: "../../request.json" }).success,
    ).toBe(false);
  });

  it("accepts the initial event vocabulary and rejects unversioned events", () => {
    expect(runEventSchema.parse(createdEvent).type).toBe("run.created");
    expect(runEventSchema.parse(queuedEvent).type).toBe("run.queued");
    expect(
      runEventSchema.safeParse({ ...queuedEvent, schemaVersion: undefined }).success,
    ).toBe(false);
  });

  it("accepts a rebuildable snapshot and versioned create response", () => {
    expect(runSnapshotSchema.parse(snapshot)).toMatchObject({
      status: "queued",
      lastSequence: 2,
    });
    expect(
      runCreationSchema.parse({
        schemaVersion: "prism.run-creation/v1",
        status: "created",
        runId: manifest.runId,
        snapshot,
      }),
    ).toMatchObject({ status: "created", runId: manifest.runId });
  });

  it("validates Run list and dossier API responses", () => {
    const summary = {
      id: manifest.runId,
      title: snapshot.title,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      lastSequence: snapshot.lastSequence,
      integrity: "verified",
    } as const;

    expect(
      runListSchema.parse({
        schemaVersion: "prism.run-list/v1",
        runs: [summary],
      }),
    ).toMatchObject({ runs: [summary] });
    expect(
      runDossierResponseSchema.parse({
        schemaVersion: "prism.run-dossier-response/v1",
        dossier: {
          ...summary,
          prompt: request.prompt,
          workspace: request.workspace,
          viewport: request.viewport,
          artifacts: [artifact],
          terminalError: null,
        },
      }),
    ).toMatchObject({ dossier: { prompt: request.prompt } });
  });

  it("accepts typed workspace operations and rejects shell-shaped requests", () => {
    expect(
      workspaceRequestSchema.parse({
        schemaVersion: "prism.workspace-request/v1",
        requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
        runId: manifest.runId,
        operation: "inspect",
        paths: ["package.json"],
        patterns: ["packages/**/*.ts"],
      }),
    ).toMatchObject({ operation: "inspect" });

    expect(
      workspaceRequestSchema.safeParse({
        schemaVersion: "prism.workspace-request/v1",
        requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
        runId: manifest.runId,
        operation: "test",
        command: {
          executable: "pnpm test && rm -rf .",
          arguments: [],
        },
        workingDirectory: ".",
        timeoutMs: 1_000,
      }).success,
    ).toBe(false);

    expect(
      workspaceRequestSchema.safeParse({
        schemaVersion: "prism.workspace-request/v1",
        requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
        runId: manifest.runId,
        operation: "patch",
        files: [
          { path: "a.ts", expectedSha256: null, content: "a" },
          { path: "b.ts", expectedSha256: null, content: "b" },
        ],
      }).success,
    ).toBe(false);
  });

  it("binds structured workspace evidence to its hashed artifact", () => {
    const evidence = {
      schemaVersion: "prism.workspace-evidence/v1",
      requestId: "42ee0dfc-a713-49b9-bc60-8c72cced2a24",
      runId: manifest.runId,
      operation: "inspect",
      status: "succeeded",
      reasonCode: null,
      summary: "Read 1 file and discovered 2 files.",
      startedAt: "2026-07-31T04:01:00.000Z",
      finishedAt: "2026-07-31T04:01:00.010Z",
      details: {
        operation: "inspect",
        reads: [
          {
            path: "package.json",
            byteLength: 192,
            capturedSha256: "b".repeat(64),
            content: '{"name":"prism"}',
            truncated: false,
            redactionCount: 0,
          },
        ],
        discoveredPaths: ["packages/contracts/src/index.ts", "package.json"],
        discoveryTruncated: false,
      },
    } as const;

    expect(workspaceEvidenceRecordSchema.parse({ evidence, artifact })).toMatchObject({
      evidence: { status: "succeeded" },
      artifact,
    });
  });

  it("binds a Browser Baseline to the exact local observation and its hashed evidence", () => {
    const screenshot = {
      ...artifact,
      hash: "b".repeat(64),
      mediaType: "image/png",
    } as const;
    const evidence = {
      ...artifact,
      hash: "c".repeat(64),
      mediaType: "application/vnd.prism.browser-evidence+json",
    } as const;

    const baseline = {
      schemaVersion: "prism.browser-baseline/v1",
      baselineId: "26a04dcd-0069-45ec-b7ce-c7177e303c5d",
      runId: manifest.runId,
      buildIdentity: "fixture@5a6c2ab",
      route: "/settings/profile",
      browserVersion: "Chromium 142.0.0.0",
      viewport: request.viewport,
      devicePixelRatio: 1,
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
      targetIdentity: "role=button[name=Save]",
      observation: {
        observationId: "d5d02fbb-a7ec-4cad-85d7-0b6b3ac6c10b",
        url: "http://127.0.0.1:4173/settings/profile",
        viewport: request.viewport,
        pageStateHash: "d".repeat(64),
        screenshotHash: screenshot.hash,
      },
      screenshot,
      dom: evidence,
      accessibility: evidence,
      computed: evidence,
      console: evidence,
      network: evidence,
      trace: { ...evidence, mediaType: "application/zip" },
      capturedAt: "2026-08-04T04:00:00.000Z",
      supplementalVisualJudgment: null,
    } as const;

    expect(browserBaselineRecordSchema.parse(baseline)).toMatchObject({
      targetIdentity: "role=button[name=Save]",
      observation: { screenshotHash: screenshot.hash },
    });
    expect(
      browserBaselineRecordSchema.safeParse({
        ...baseline,
        observation: { ...baseline.observation, screenshotHash: "e".repeat(64) },
      }).success,
    ).toBe(false);
  });

  it("requires a coordinate action to carry the exact observation that grounded it", () => {
    expect(
      browserActionProposalSchema.parse({
        schemaVersion: "prism.browser-action-proposal/v1",
        proposalId: "6b3d5ed9-03ba-49e8-a15e-57ac91ef8ef8",
        runId: manifest.runId,
        origin: "ui-tars",
        action: { kind: "click" },
        target: {
          kind: "coordinate",
          x: 240,
          y: 160,
          observationId: "d5d02fbb-a7ec-4cad-85d7-0b6b3ac6c10b",
          screenshotHash: "b".repeat(64),
          pageStateHash: "d".repeat(64),
          viewport: request.viewport,
        },
      }),
    ).toMatchObject({ target: { kind: "coordinate" } });

    expect(
      browserActionProposalSchema.safeParse({
        schemaVersion: "prism.browser-action-proposal/v1",
        proposalId: "6b3d5ed9-03ba-49e8-a15e-57ac91ef8ef8",
        runId: manifest.runId,
        origin: "ui-tars",
        action: { kind: "click" },
        target: { kind: "coordinate", x: 240, y: 160 },
      }).success,
    ).toBe(false);
  });
});
