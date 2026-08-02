import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import {
  type RepairRequest,
  RUN_CREATION_SCHEMA_VERSION,
  RUN_EVENT_SCHEMA_VERSION,
  type RunCreation,
  runCreationSchema,
  type RunDossier,
  runDossierSchema,
  runIdSchema,
  type RunSummary,
  runSummarySchema,
  type TerminalRunError,
  type WorkspaceEvidenceRecord,
  workspaceEvidenceRecordSchema,
  workspaceRequestSchema,
} from "@prism/contracts";
import {
  type DurableRun,
  FileTrajectoryStore,
  RunIntegrityError,
  runTitleFromPrompt,
} from "@prism/trajectory-store";
import { WorkspaceExecutor } from "@prism/workspace-executor";

const WORKSPACE_EVIDENCE_MEDIA_TYPE = "application/vnd.prism.workspace-evidence+json";

export type RecentRun = RunSummary;
export type { RunDossier };

let activeStore: { dataDirectory: string; store: FileTrajectoryStore } | undefined;

function getDataDirectory() {
  const configured = process.env.PRISM_DATA_DIR?.trim();
  return path.resolve(configured && configured.length > 0 ? configured : ".prism");
}

function getStore() {
  const dataDirectory = getDataDirectory();
  if (!activeStore || activeStore.dataDirectory !== dataDirectory) {
    activeStore = {
      dataDirectory,
      store: new FileTrajectoryStore({ dataDirectory }),
    };
  }

  return activeStore.store;
}

function dossierFromRun(run: DurableRun): RunDossier {
  return runDossierSchema.parse({
    id: run.manifest.runId,
    title: run.snapshot.title,
    status: run.snapshot.status,
    createdAt: run.snapshot.createdAt,
    updatedAt: run.snapshot.updatedAt,
    lastSequence: run.snapshot.lastSequence,
    integrity: "verified",
    prompt: run.manifest.request.prompt,
    workspace: run.manifest.request.workspace,
    viewport: run.manifest.request.viewport,
    artifacts: run.snapshot.artifacts,
    workspaceEvidence: run.snapshot.workspaceEvidence,
    terminalError: run.snapshot.terminalError,
  });
}

async function failedDossier(runId: string, error: unknown): Promise<RunDossier> {
  const store = getStore();
  let manifest = null;
  try {
    manifest = await store.loadManifest(runId);
  } catch {
    // A corrupt manifest cannot safely contribute display state.
  }

  const terminalError: TerminalRunError =
    error instanceof RunIntegrityError
      ? { code: error.code, message: error.message }
      : {
          code: "storage_error",
          message: `Run ${runId} could not be read from durable storage.`,
        };

  return runDossierSchema.parse({
    id: runId,
    title: manifest
      ? runTitleFromPrompt(manifest.request.prompt)
      : `Unreadable Run ${runId}`,
    status: "terminal_error",
    createdAt: manifest?.createdAt ?? null,
    updatedAt: manifest?.createdAt ?? null,
    lastSequence: 0,
    integrity: "failed",
    prompt: manifest?.request.prompt ?? null,
    workspace: manifest?.request.workspace ?? null,
    viewport: manifest?.request.viewport ?? null,
    artifacts: manifest ? [manifest.requestArtifact] : [],
    workspaceEvidence: [],
    terminalError,
  });
}

async function loadDossier(runId: string): Promise<RunDossier> {
  try {
    return dossierFromRun(await getStore().loadRun(runId));
  } catch (error) {
    return failedDossier(runId, error);
  }
}

export async function createRun(request: RepairRequest): Promise<RunCreation> {
  const run = await getStore().createRun(request);
  return runCreationSchema.parse({
    schemaVersion: RUN_CREATION_SCHEMA_VERSION,
    status: "created",
    runId: run.manifest.runId,
    snapshot: run.snapshot,
  });
}

export async function listRecentRuns(): Promise<readonly RecentRun[]> {
  const runIds = await getStore().listRunIds();
  const dossiers = await Promise.all(runIds.map((runId) => loadDossier(runId)));

  return dossiers
    .map((dossier) =>
      runSummarySchema.parse({
        id: dossier.id,
        title: dossier.title,
        status: dossier.status,
        createdAt: dossier.createdAt,
        updatedAt: dossier.updatedAt,
        lastSequence: dossier.lastSequence,
        integrity: dossier.integrity,
      }),
    )
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
}

export async function getRunDossier(runIdInput: string): Promise<RunDossier | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) {
    return null;
  }

  const runIds = await getStore().listRunIds();
  if (!runIds.includes(parsedRunId.data)) {
    return null;
  }

  return loadDossier(parsedRunId.data);
}

export async function executeWorkspaceRequest(
  runIdInput: string,
  requestInput: unknown,
  signal?: AbortSignal,
): Promise<WorkspaceEvidenceRecord | null> {
  const parsedRunId = runIdSchema.safeParse(runIdInput);
  if (!parsedRunId.success) return null;

  const store = getStore();
  const runIds = await store.listRunIds();
  if (!runIds.includes(parsedRunId.data)) return null;

  const request = workspaceRequestSchema.parse(requestInput);
  if (request.runId !== parsedRunId.data) {
    throw new TypeError("Workspace request Run ID does not match the route Run ID.");
  }

  const run = await store.loadRun(parsedRunId.data);
  const executor = await WorkspaceExecutor.create({
    workspaceRoot: run.manifest.request.workspace.path,
    allowedReadPatterns: [
      "package.json",
      "README.md",
      "apps/**/*.{ts,tsx,json,mjs}",
      "packages/**/*.{ts,tsx,json,mjs}",
    ],
    allowedDiscoveryPatterns: [
      "apps/**/*.{ts,tsx}",
      "packages/**/*.ts",
      "**/*.{test,spec}.{ts,tsx}",
    ],
    allowedCommands: [
      {
        command: { executable: "pnpm", arguments: ["test"] },
        workingDirectories: ["."],
      },
    ],
  });
  const evidence = await executor.execute(request, { signal });
  const artifact = await store.writeArtifact(
    `${JSON.stringify(evidence)}\n`,
    WORKSPACE_EVIDENCE_MEDIA_TYPE,
  );
  const record = workspaceEvidenceRecordSchema.parse({ evidence, artifact });
  const previousEvent = run.events.at(-1);

  await store.appendEvent({
    schemaVersion: RUN_EVENT_SCHEMA_VERSION,
    eventId: randomUUID(),
    runId: parsedRunId.data,
    sequence: run.events.length + 1,
    recordedAt: new Date().toISOString(),
    correlationId: parsedRunId.data,
    causationEventId: previousEvent?.eventId ?? null,
    type: "workspace.evidence",
    payload: record,
  });

  return record;
}
