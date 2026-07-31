import path from "node:path";
import process from "node:process";

import {
  type RepairRequest,
  RUN_CREATION_SCHEMA_VERSION,
  type RunCreation,
  runCreationSchema,
  type RunDossier,
  runDossierSchema,
  runIdSchema,
  type RunSummary,
  runSummarySchema,
  type TerminalRunError,
} from "@prism/contracts";
import {
  type DurableRun,
  FileTrajectoryStore,
  RunIntegrityError,
  runTitleFromPrompt,
} from "@prism/trajectory-store";

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
