import { describe, expect, it } from "vitest";

import {
  artifactRefSchema,
  runCreationSchema,
  runDossierResponseSchema,
  runEventSchema,
  runListSchema,
  runManifestSchema,
  runSnapshotSchema,
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
});
