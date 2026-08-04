import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  ARTIFACT_REF_SCHEMA_VERSION,
  type ArtifactRef,
  artifactRefSchema,
  type BrowserActionRecord,
  browserActionRecordSchema,
  type BrowserBaselineRecord,
  browserBaselineRecordSchema,
  repairRequestSchema,
  RUN_EVENT_SCHEMA_VERSION,
  RUN_MANIFEST_SCHEMA_VERSION,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  type RunEvent,
  runEventSchema,
  runIdSchema,
  type RunManifest,
  runManifestSchema,
  type RunSnapshot,
  runSnapshotSchema,
  type TerminalRunError,
  type WorkspaceEvidenceRecord,
  workspaceEvidenceRecordSchema,
} from "@prism/contracts";

const REPAIR_REQUEST_ARTIFACT_MEDIA_TYPE = "application/vnd.prism.repair-request+json";
const runWriteQueues = new Map<string, Promise<void>>();

export interface DurableRun {
  manifest: RunManifest;
  events: RunEvent[];
  snapshot: RunSnapshot;
}

export interface FileTrajectoryStoreOptions {
  dataDirectory: string;
  clock?: () => Date;
  eventIdFactory?: () => string;
  runIdFactory?: () => string;
}

export class RunIntegrityError extends Error {
  readonly code: TerminalRunError["code"];

  constructor(code: TerminalRunError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunIntegrityError";
    this.code = code;
  }
}

export function runTitleFromPrompt(prompt: string): string {
  const title = prompt.trim().replace(/\s+/g, " ");

  return title.length <= 160 ? title : `${title.slice(0, 157)}…`;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

function uniqueArtifacts(
  existing: readonly ArtifactRef[],
  additions: readonly ArtifactRef[],
): ArtifactRef[] {
  const seen = new Set(existing.map((artifact) => `${artifact.algorithm}:${artifact.hash}`));
  const unique = [...existing];

  additions.forEach((artifact) => {
    const key = `${artifact.algorithm}:${artifact.hash}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(artifact);
    }
  });

  return unique;
}

function browserBaselineArtifacts(baseline: BrowserBaselineRecord): ArtifactRef[] {
  return [
    baseline.screenshot,
    baseline.dom,
    baseline.accessibility,
    baseline.computed,
    baseline.console,
    baseline.network,
    baseline.trace,
  ];
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function asEvent(input: unknown, position?: number): RunEvent {
  const parsed = runEventSchema.safeParse(input);
  if (!parsed.success) {
    const location = position === undefined ? "candidate" : `line ${position}`;
    throw new RunIntegrityError(
      "corrupt_event",
      `The Run event at ${location} does not match the supported schema.`,
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

export function projectRunEvents(
  manifestInput: unknown,
  eventInputs: readonly unknown[],
): RunSnapshot {
  const parsedManifest = runManifestSchema.safeParse(manifestInput);
  if (!parsedManifest.success) {
    throw new RunIntegrityError(
      "corrupt_manifest",
      "The Run manifest does not match the supported schema.",
      { cause: parsedManifest.error },
    );
  }

  const manifest = parsedManifest.data;
  let snapshot: RunSnapshot | null = null;

  eventInputs.forEach((input, index) => {
    const event = asEvent(input, index + 1);
    const expectedSequence = index + 1;

    if (event.runId !== manifest.runId || event.sequence !== expectedSequence) {
      throw new RunIntegrityError(
        "corrupt_event",
        `Run events must belong to ${manifest.runId} and use uninterrupted sequence numbers.`,
      );
    }

    if (event.type === "run.created") {
      if (
        snapshot !== null ||
        event.sequence !== 1 ||
        !isDeepStrictEqual(event.payload.requestArtifact, manifest.requestArtifact)
      ) {
        throw new RunIntegrityError(
          "corrupt_event",
          "The first Run event must create the manifest's request artifact exactly once.",
        );
      }

      snapshot = runSnapshotSchema.parse({
        schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
        runId: manifest.runId,
        title: runTitleFromPrompt(manifest.request.prompt),
        status: "created",
        createdAt: manifest.createdAt,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        artifacts: [event.payload.requestArtifact],
        workspaceEvidence: [],
        browserBaselines: [],
        browserActions: [],
        terminalError: null,
      });
      return;
    }

    if (snapshot === null || snapshot.status === "terminal_error") {
      throw new RunIntegrityError(
        "corrupt_event",
        "The Run journal contains an event after an invalid or terminal state.",
      );
    }

    if (event.type === "run.queued") {
      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        status: "queued",
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
      });
      return;
    }

    if (event.type === "workspace.evidence") {
      if (event.payload.evidence.runId !== manifest.runId) {
        throw new RunIntegrityError(
          "corrupt_event",
          "Workspace evidence must belong to the Run that journals it.",
        );
      }

      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        artifacts: [...snapshot.artifacts, event.payload.artifact],
        workspaceEvidence: [...snapshot.workspaceEvidence, event.payload],
      });
      return;
    }

    if (event.type === "browser.baseline") {
      if (event.payload.runId !== manifest.runId) {
        throw new RunIntegrityError(
          "corrupt_event",
          "Browser Baseline evidence must belong to the Run that journals it.",
        );
      }

      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        artifacts: uniqueArtifacts(snapshot.artifacts, browserBaselineArtifacts(event.payload)),
        browserBaselines: [...snapshot.browserBaselines, event.payload],
      });
      return;
    }

    if (event.type === "browser.action") {
      if (event.payload.proposal.runId !== manifest.runId) {
        throw new RunIntegrityError(
          "corrupt_event",
          "Browser actions must belong to the Run that journals them.",
        );
      }

      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        browserActions: [...snapshot.browserActions, event.payload],
      });
      return;
    }

    snapshot = runSnapshotSchema.parse({
      ...snapshot,
      status: "terminal_error",
      updatedAt: event.recordedAt,
      lastSequence: event.sequence,
      terminalError: event.payload,
    });
  });

  if (snapshot === null) {
    throw new RunIntegrityError(
      "corrupt_event",
      "The Run journal has no creation event.",
    );
  }

  return snapshot;
}

export class FileTrajectoryStore {
  readonly dataDirectory: string;
  private readonly clock: () => Date;
  private readonly eventIdFactory: () => string;
  private readonly runIdFactory: () => string;

  constructor(options: FileTrajectoryStoreOptions) {
    this.dataDirectory = path.resolve(options.dataDirectory);
    this.clock = options.clock ?? (() => new Date());
    this.eventIdFactory = options.eventIdFactory ?? randomUUID;
    this.runIdFactory = options.runIdFactory ?? (() => `run_${randomUUID()}`);
  }

  async createRun(requestInput: unknown): Promise<DurableRun> {
    const request = repairRequestSchema.parse(requestInput);
    const runId = runIdSchema.parse(this.runIdFactory());
    const recordedAt = this.clock().toISOString();
    const requestArtifact = await this.writeArtifact(
      Buffer.from(serializeJsonLine(request), "utf8"),
      REPAIR_REQUEST_ARTIFACT_MEDIA_TYPE,
    );
    const manifest = runManifestSchema.parse({
      schemaVersion: RUN_MANIFEST_SCHEMA_VERSION,
      runId,
      createdAt: recordedAt,
      request,
      requestArtifact,
    });
    const createdEvent = asEvent({
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: this.eventIdFactory(),
      runId,
      sequence: 1,
      recordedAt,
      correlationId: runId,
      causationEventId: null,
      type: "run.created",
      payload: { requestArtifact },
    });
    const queuedEvent = asEvent({
      schemaVersion: RUN_EVENT_SCHEMA_VERSION,
      eventId: this.eventIdFactory(),
      runId,
      sequence: 2,
      recordedAt,
      correlationId: runId,
      causationEventId: createdEvent.eventId,
      type: "run.queued",
      payload: {},
    });
    const events = [createdEvent, queuedEvent];
    const snapshot = projectRunEvents(manifest, events);
    const runsDirectory = path.join(this.dataDirectory, "runs");
    const finalDirectory = this.runDirectory(runId);
    const temporaryDirectory = path.join(
      runsDirectory,
      `.tmp-${runId}-${randomUUID()}`,
    );

    await mkdir(runsDirectory, { recursive: true });
    await mkdir(temporaryDirectory);

    try {
      await Promise.all([
        writeFile(
          path.join(temporaryDirectory, "manifest.json"),
          serializeJsonLine(manifest),
          {
            encoding: "utf8",
            flag: "wx",
          },
        ),
        writeFile(
          path.join(temporaryDirectory, "events.jsonl"),
          events.map((event) => serializeJsonLine(event)).join(""),
          { encoding: "utf8", flag: "wx" },
        ),
        writeFile(
          path.join(temporaryDirectory, "snapshot.json"),
          serializeJsonLine(snapshot),
          {
            encoding: "utf8",
            flag: "wx",
          },
        ),
      ]);
      await rename(temporaryDirectory, finalDirectory);
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      throw new RunIntegrityError(
        "storage_error",
        `Prism could not commit Run ${runId} atomically.`,
        { cause: error },
      );
    }

    return { manifest, events, snapshot };
  }

  async appendEvent(input: unknown): Promise<RunSnapshot> {
    const event = asEvent(input);

    return this.withRunWrite(event.runId, async () => {
      const current = await this.loadRun(event.runId);
      const expectedSequence = current.events.length + 1;
      if (event.sequence !== expectedSequence) {
        throw new RunIntegrityError(
          "corrupt_event",
          `Run ${event.runId} expected event sequence ${expectedSequence}, not ${event.sequence}.`,
        );
      }
      return this.commitEvent(current, event);
    });
  }

  async recordWorkspaceEffect(
    runIdInput: string,
    effect: (run: DurableRun) => Promise<unknown>,
  ): Promise<WorkspaceEvidenceRecord> {
    const runId = runIdSchema.parse(runIdInput);

    return this.withRunWrite(runId, async () => {
      const current = await this.loadRun(runId);
      const record: WorkspaceEvidenceRecord = workspaceEvidenceRecordSchema.parse(
        await effect(current),
      );
      const previousEvent = current.events.at(-1);
      const event = asEvent({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        eventId: this.eventIdFactory(),
        runId,
        sequence: current.events.length + 1,
        recordedAt: this.clock().toISOString(),
        correlationId: runId,
        causationEventId: previousEvent?.eventId ?? null,
        type: "workspace.evidence",
        payload: record,
      });
      await this.commitEvent(current, event);
      return record;
    });
  }

  async recordBrowserEffect(
    runIdInput: string,
    effect: (run: DurableRun) => Promise<unknown>,
  ): Promise<BrowserBaselineRecord> {
    const runId = runIdSchema.parse(runIdInput);

    return this.withRunWrite(runId, async () => {
      const current = await this.loadRun(runId);
      const baseline = browserBaselineRecordSchema.parse(await effect(current));
      const previousEvent = current.events.at(-1);
      const event = asEvent({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        eventId: this.eventIdFactory(),
        runId,
        sequence: current.events.length + 1,
        recordedAt: this.clock().toISOString(),
        correlationId: runId,
        causationEventId: previousEvent?.eventId ?? null,
        type: "browser.baseline",
        payload: baseline,
      });
      await this.commitEvent(current, event);
      return baseline;
    });
  }

  async recordBrowserAction(
    runIdInput: string,
    effect: (run: DurableRun) => Promise<unknown>,
  ): Promise<BrowserActionRecord> {
    const runId = runIdSchema.parse(runIdInput);

    return this.withRunWrite(runId, async () => {
      const current = await this.loadRun(runId);
      const record = browserActionRecordSchema.parse(await effect(current));
      const previousEvent = current.events.at(-1);
      const event = asEvent({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        eventId: this.eventIdFactory(),
        runId,
        sequence: current.events.length + 1,
        recordedAt: this.clock().toISOString(),
        correlationId: runId,
        causationEventId: previousEvent?.eventId ?? null,
        type: "browser.action",
        payload: record,
      });
      await this.commitEvent(current, event);
      return record;
    });
  }

  async loadManifest(runIdInput: string): Promise<RunManifest> {
    const runId = runIdSchema.parse(runIdInput);
    let input: unknown;

    try {
      input = JSON.parse(
        await readFile(path.join(this.runDirectory(runId), "manifest.json"), "utf8"),
      );
    } catch (error) {
      throw new RunIntegrityError(
        "corrupt_manifest",
        `Run ${runId} has no readable manifest.`,
        {
          cause: error,
        },
      );
    }

    const manifest = runManifestSchema.safeParse(input);
    if (!manifest.success || manifest.data.runId !== runId) {
      throw new RunIntegrityError(
        "corrupt_manifest",
        `Run ${runId} has an invalid or mismatched manifest.`,
        { cause: manifest.success ? undefined : manifest.error },
      );
    }

    return manifest.data;
  }

  async loadRun(runIdInput: string): Promise<DurableRun> {
    const runId = runIdSchema.parse(runIdInput);
    const runDirectory = this.runDirectory(runId);
    const manifest = await this.loadManifest(runId);
    let journal: string;

    try {
      journal = await readFile(path.join(runDirectory, "events.jsonl"), "utf8");
    } catch (error) {
      throw new RunIntegrityError(
        "corrupt_event",
        `Run ${runId} has no readable journal.`,
        {
          cause: error,
        },
      );
    }

    if (!journal.endsWith("\n")) {
      throw new RunIntegrityError(
        "corrupt_event",
        `Run ${runId} journal ends with a torn record.`,
      );
    }

    const lines = journal.slice(0, -1).split("\n");
    if (lines.some((line) => line.length === 0)) {
      throw new RunIntegrityError(
        "corrupt_event",
        `Run ${runId} journal contains a blank record.`,
      );
    }

    const events = lines.map((line, index) => {
      try {
        return asEvent(JSON.parse(line), index + 1);
      } catch (error) {
        if (error instanceof RunIntegrityError) {
          throw error;
        }
        throw new RunIntegrityError(
          "corrupt_event",
          `Run ${runId} event line ${index + 1} is not valid JSON.`,
          { cause: error },
        );
      }
    });
    const snapshot = projectRunEvents(manifest, events);

    await this.verifyManifestRequest(manifest);
    await Promise.all(
      snapshot.artifacts
        .filter((artifact) => !isDeepStrictEqual(artifact, manifest.requestArtifact))
        .map((artifact) => this.readArtifact(artifact)),
    );
    await this.repairSnapshotCache(runDirectory, snapshot);

    return { manifest, events, snapshot };
  }

  async listRunIds(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(path.join(this.dataDirectory, "runs"), {
        withFileTypes: true,
      });
    } catch (error) {
      if (isMissingFile(error)) {
        try {
          const dataDirectory = await stat(this.dataDirectory);
          if (dataDirectory.isDirectory()) return [];
        } catch (dataDirectoryError) {
          if (isMissingFile(dataDirectoryError)) return [];
          throw dataDirectoryError;
        }
      }
      throw error;
    }

    return entries
      .filter(
        (entry) => entry.isDirectory() && runIdSchema.safeParse(entry.name).success,
      )
      .map((entry) => entry.name)
      .sort();
  }

  async writeArtifact(
    content: Uint8Array | string,
    mediaType: string,
  ): Promise<ArtifactRef> {
    const bytes =
      typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
    const hash = hashBytes(bytes);
    const artifact = artifactRefSchema.parse({
      schemaVersion: ARTIFACT_REF_SCHEMA_VERSION,
      algorithm: "sha256",
      hash,
      byteLength: bytes.byteLength,
      mediaType,
    });
    const artifactPath = this.artifactPath(artifact);

    try {
      const existing = await readFile(artifactPath);
      this.verifyArtifactBytes(artifact, existing);
      return artifact;
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }

    await this.atomicWrite(artifactPath, bytes);
    return artifact;
  }

  async readArtifact(referenceInput: unknown): Promise<Buffer> {
    const reference = artifactRefSchema.parse(referenceInput);
    let bytes: Buffer;

    try {
      bytes = await readFile(this.artifactPath(reference));
    } catch (error) {
      throw new RunIntegrityError(
        "corrupt_artifact",
        `Artifact ${reference.hash} is missing or unreadable.`,
        { cause: error },
      );
    }

    this.verifyArtifactBytes(reference, bytes);
    return bytes;
  }

  private artifactPath(reference: ArtifactRef): string {
    return path.join(
      this.dataDirectory,
      "artifacts",
      reference.algorithm,
      reference.hash.slice(0, 2),
      reference.hash,
    );
  }

  private runDirectory(runId: string): string {
    return path.join(this.dataDirectory, "runs", runIdSchema.parse(runId));
  }

  private verifyArtifactBytes(reference: ArtifactRef, bytes: Uint8Array): void {
    if (
      bytes.byteLength !== reference.byteLength ||
      hashBytes(bytes) !== reference.hash
    ) {
      throw new RunIntegrityError(
        "corrupt_artifact",
        `Artifact ${reference.hash} failed its SHA-256 integrity check.`,
      );
    }
  }

  private async verifyManifestRequest(manifest: RunManifest): Promise<void> {
    if (manifest.requestArtifact.mediaType !== REPAIR_REQUEST_ARTIFACT_MEDIA_TYPE) {
      throw new RunIntegrityError(
        "corrupt_manifest",
        `Run ${manifest.runId} request artifact has the wrong media type.`,
      );
    }

    const bytes = await this.readArtifact(manifest.requestArtifact);
    let input: unknown;
    try {
      input = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
      throw new RunIntegrityError(
        "corrupt_manifest",
        `Run ${manifest.runId} request artifact is not valid JSON.`,
        { cause: error },
      );
    }

    const request = repairRequestSchema.safeParse(input);
    if (!request.success || !isDeepStrictEqual(request.data, manifest.request)) {
      throw new RunIntegrityError(
        "corrupt_manifest",
        `Run ${manifest.runId} request no longer matches its hashed artifact.`,
        { cause: request.success ? undefined : request.error },
      );
    }
  }

  private async commitEvent(
    current: DurableRun,
    event: RunEvent,
  ): Promise<RunSnapshot> {
    const events = [...current.events, event];
    const snapshot = projectRunEvents(current.manifest, events);
    const runDirectory = this.runDirectory(event.runId);

    await appendFile(
      path.join(runDirectory, "events.jsonl"),
      serializeJsonLine(event),
      "utf8",
    );
    await this.tryWriteSnapshotCache(runDirectory, snapshot);
    return snapshot;
  }

  private async atomicWrite(
    filePath: string,
    content: Uint8Array | string,
  ): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { flag: "wx" });
      await rename(temporaryPath, filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async writeSnapshot(
    runDirectory: string,
    snapshot: RunSnapshot,
  ): Promise<void> {
    await this.atomicWrite(
      path.join(runDirectory, "snapshot.json"),
      serializeJsonLine(snapshot),
    );
  }

  private async repairSnapshotCache(
    runDirectory: string,
    snapshot: RunSnapshot,
  ): Promise<void> {
    const snapshotPath = path.join(runDirectory, "snapshot.json");
    try {
      const cached = runSnapshotSchema.safeParse(
        JSON.parse(await readFile(snapshotPath, "utf8")) as unknown,
      );
      if (cached.success && isDeepStrictEqual(cached.data, snapshot)) {
        return;
      }
      if (
        cached.success &&
        cached.data.runId === snapshot.runId &&
        cached.data.lastSequence > snapshot.lastSequence
      ) {
        throw new RunIntegrityError(
          "corrupt_event",
          `Run ${snapshot.runId} journal ends before its last witnessed sequence.`,
        );
      }
    } catch (error) {
      if (error instanceof RunIntegrityError) {
        throw error;
      }
      // Snapshot is a disposable projection cache; the journal rebuild below is canonical.
    }

    await this.tryWriteSnapshotCache(runDirectory, snapshot);
  }

  private async tryWriteSnapshotCache(
    runDirectory: string,
    snapshot: RunSnapshot,
  ): Promise<void> {
    try {
      await this.writeSnapshot(runDirectory, snapshot);
    } catch {
      // The event journal is already canonical. A cache failure must not turn a
      // committed append or a verified read into an ambiguous operation failure.
    }
  }

  private async withRunWrite<T>(
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const queueKey = this.runDirectory(runId);
    const previous = runWriteQueues.get(queueKey) ?? Promise.resolve();
    const current = previous.then(operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    runWriteQueues.set(queueKey, tail);
    void tail.then(() => {
      if (runWriteQueues.get(queueKey) === tail) {
        runWriteQueues.delete(queueKey);
      }
    });

    return current;
  }
}
