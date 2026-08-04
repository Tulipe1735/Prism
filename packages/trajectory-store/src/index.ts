/**
 * Prism 轨迹存储（trajectory-store）包
 *
 * 负责 Run 的持久化：以"追加式事件日志 + 内容寻址产物"为规范事实
 * （canonical state），Run 快照只是由事件日志重放得到的可丢弃投影。
 *
 * 目录布局（dataDirectory 下）：
 *  - runs/<runId>/manifest.json   不可变清单（请求 + 产物引用）
 *  - runs/<runId>/events.jsonl    追加式事件日志，每行一个事件
 *  - runs/<runId>/snapshot.json   快照投影缓存（可由日志重建）
 *  - artifacts/<algo>/<前两位>/<hash>   内容寻址产物存储
 *
 * 写入一律采用原子方式（临时文件 + rename），并在单个 Run 内以
 * 串行写队列（withRunWrite）保证事件序号连续、无并发交错。
 * 任何损坏（日志断行、序号跳变、产物哈希不符等）都会抛出 RunIntegrityError。
 */
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
  type EffectLease,
  effectLeaseSchema,
  repairRequestSchema,
  RUN_EVENT_SCHEMA_VERSION,
  RUN_MANIFEST_SCHEMA_VERSION,
  RUN_SNAPSHOT_SCHEMA_VERSION,
  type RunDagRevision,
  runDagRevisionSchema,
  type RunEvent,
  runEventSchema,
  runIdSchema,
  type RunManifest,
  runManifestSchema,
  type RunNodeProgress,
  runNodeProgressSchema,
  type RunSnapshot,
  runSnapshotSchema,
  type TerminalRunError,
  type WorkspaceEvidenceRecord,
  workspaceEvidenceRecordSchema,
} from "@prism/contracts";

/** 修复请求产物的媒体类型，用于清单请求产物校验。 */
const REPAIR_REQUEST_ARTIFACT_MEDIA_TYPE = "application/vnd.prism.repair-request+json";
/** 每个 Run 目录一个串行写队列，保证同一 Run 的事件追加不交错。 */
const runWriteQueues = new Map<string, Promise<void>>();

/** 一次可重开的 Run：清单 + 事件日志 + 重放出的快照。 */
export interface DurableRun {
  manifest: RunManifest;
  events: RunEvent[];
  snapshot: RunSnapshot;
}

/** 文件型轨迹存储的构造选项。 */
export interface FileTrajectoryStoreOptions {
  /** 数据根目录；不存在时会按需创建。 */
  dataDirectory: string;
  /** 时钟注入，便于测试固定时间。 */
  clock?: () => Date;
  /** 事件 ID 生成器，默认 randomUUID。 */
  eventIdFactory?: () => string;
  /** Run ID 生成器，默认 "run_" + uuid。 */
  runIdFactory?: () => string;
}

/**
 * Run 完整性错误：日志/清单/产物损坏时抛出的不可恢复错误。
 *
 * code 对应契约中的终止错误码（corrupt_event / corrupt_artifact /
 * corrupt_manifest / storage_error），写入 Run 的终止错误事件。
 */
export class RunIntegrityError extends Error {
  readonly code: TerminalRunError["code"];

  constructor(code: TerminalRunError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RunIntegrityError";
    this.code = code;
  }
}

/** 从请求文案生成 Run 标题：折叠空白，截断到 160 字符。 */
export function runTitleFromPrompt(prompt: string): string {
  const title = prompt.trim().replace(/\s+/g, " ");

  return title.length <= 160 ? title : `${title.slice(0, 157)}…`;
}

/** 计算字节数组的 SHA-256 十六进制摘要。 */
function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 序列化单行 JSON（末尾带换行），用于 events.jsonl 与清单/快照文件。 */
function serializeJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** 合并产物列表并按 (算法:哈希) 去重，保持已有顺序与新增顺序。 */
function uniqueArtifacts(
  existing: readonly ArtifactRef[],
  additions: readonly ArtifactRef[],
): ArtifactRef[] {
  const seen = new Set(
    existing.map((artifact) => `${artifact.algorithm}:${artifact.hash}`),
  );
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

/** 收集一条浏览器基线记录引用的全部产物（截图/DOM/无障碍/样式/控制台/网络/trace）。 */
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

/** 判断错误是否为"文件不存在"（ENOENT）。 */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * 把任意输入校验为一条 Run 事件。
 *
 * @throws RunIntegrityError(corrupt_event) 当输入不符合事件 schema 时，
 *   position 用于错误信息中定位日志行号
 */
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

/**
 * 从清单与事件列表重放得到 Run 快照，同时校验日志完整性。
 *
 * 强制的不变量包括：事件必须属于同一 Run、序号从 1 连续递增、
 * 首条事件必须是 run.created 且只出现一次、DAG 修订连续追加、
 * 节点进度必须引用已存在的 DAG 节点且与事件信封字段一致、
 * 终止错误后不允许再有后续事件。
 *
 * @throws RunIntegrityError 任一不变量被破坏时
 */
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

    // 事件必须属于该 Run 且序号与位置严格一致
    if (event.runId !== manifest.runId || event.sequence !== expectedSequence) {
      throw new RunIntegrityError(
        "corrupt_event",
        `Run events must belong to ${manifest.runId} and use uninterrupted sequence numbers.`,
      );
    }

    if (event.type === "run.created") {
      // 首条事件必须创建请求产物，且只能创建一次
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
        dagRevisions: [],
        nodeProgress: [],
        effectLease: null,
        terminalError: null,
      });
      return;
    }

    // 创建事件之后，终止状态后不允许再追加事件
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

      // 基线引用的全部子产物并入 artifacts（去重）
      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        artifacts: uniqueArtifacts(
          snapshot.artifacts,
          browserBaselineArtifacts(event.payload),
        ),
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
    if (event.type === "run.dag-revision") {
      // DAG 修订必须从 1 开始连续追加
      if (event.payload.revision !== snapshot.dagRevisions.length + 1) {
        throw new RunIntegrityError(
          "corrupt_event",
          "Run DAG revisions must append in uninterrupted order.",
        );
      }

      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        dagRevisions: [...snapshot.dagRevisions, event.payload],
      });
      return;
    }

    if (event.type === "run.node-progress") {
      // 节点进度必须引用已存在的 DAG 节点，且日志位置/关联 ID 与事件信封一致
      const revision = snapshot.dagRevisions.find(
        (candidate) => candidate.revision === event.payload.revision,
      );
      const node = revision?.nodes.find(
        (candidate) => candidate.nodeId === event.payload.nodeId,
      );
      if (
        !node ||
        event.payload.journalPosition !== event.sequence ||
        event.payload.correlationId !== event.correlationId ||
        event.payload.causationEventId !== event.causationEventId
      ) {
        throw new RunIntegrityError(
          "corrupt_event",
          "Node progress must reference its DAG node and matching journal envelope.",
        );
      }

      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        artifacts: uniqueArtifacts(snapshot.artifacts, event.payload.artifacts),
        nodeProgress: [...snapshot.nodeProgress, event.payload],
      });
      return;
    }

    if (event.type === "run.effect-lease") {
      snapshot = runSnapshotSchema.parse({
        ...snapshot,
        updatedAt: event.recordedAt,
        lastSequence: event.sequence,
        effectLease: event.payload,
      });
      return;
    }

    // 其余事件类型（run.terminal-error）→ 进入终止错误状态
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

/**
 * 文件型轨迹存储：把 Run 持久化为清单 + 事件日志 + 内容寻址产物。
 */
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

  /**
   * 原子地创建一次 Run：写入请求产物、清单，并生成 created + queued
   * 两条初始事件与初始快照。
   *
   * 写入先在临时目录完成，成功后整体 rename 到最终目录，避免半成品目录。
   *
   * @param requestInput 必须通过 repairRequestSchema 校验的修复请求
   * @returns 新的 DurableRun
   */
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
      // 三个文件并行写入临时目录，成功后整体改名提交
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

  /**
   * 追加一条事件到指定 Run。
   *
   * @param input 必须通过 runEventSchema 校验的事件
   * @returns 追加后的新快照
   */
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

  /**
   * 记录一条工作区证据：先在锁内执行副作用生成证据记录，再原子追加事件。
   *
   * @param runIdInput 目标 Run ID
   * @param effect 读取当前 Run、产出合法工作区证据记录的回调
   * @returns 落盘后的证据记录
   */
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

  /**
   * 记录一条浏览器基线：先执行副作用生成基线记录，再原子追加事件。
   */
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

  /**
   * 记录一条浏览器动作：先执行副作用生成动作记录，再原子追加事件。
   */
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

  /**
   * 记录一条 DAG 修订：强制修订号在现有基础上连续 +1，再原子追加事件。
   */
  async recordDagRevision(
    runIdInput: string,
    revisionInput: unknown,
  ): Promise<RunDagRevision> {
    const runId = runIdSchema.parse(runIdInput);

    return this.withRunWrite(runId, async () => {
      const current = await this.loadRun(runId);
      const revision = runDagRevisionSchema.parse(revisionInput);
      if (revision.revision !== current.snapshot.dagRevisions.length + 1) {
        throw new RunIntegrityError(
          "corrupt_event",
          "Run DAG revisions must append after the current durable revision.",
        );
      }
      const previousEvent = current.events.at(-1);
      const event = asEvent({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        eventId: this.eventIdFactory(),
        runId,
        sequence: current.events.length + 1,
        recordedAt: this.clock().toISOString(),
        correlationId: runId,
        causationEventId: previousEvent?.eventId ?? null,
        type: "run.dag-revision",
        payload: revision,
      });
      await this.commitEvent(current, event);
      return revision;
    });
  }

  /**
   * 记录一条节点进度：补全信封字段（schemaVersion、journalPosition、
   * causationEventId、recordedAt）后校验并原子追加事件。
   */
  async recordNodeProgress(
    runIdInput: string,
    input: Omit<
      RunNodeProgress,
      "schemaVersion" | "journalPosition" | "causationEventId" | "recordedAt"
    >,
  ): Promise<RunNodeProgress> {
    const runId = runIdSchema.parse(runIdInput);

    return this.withRunWrite(runId, async () => {
      const current = await this.loadRun(runId);
      const previousEvent = current.events.at(-1);
      const progress = runNodeProgressSchema.parse({
        ...input,
        schemaVersion: "prism.run-node-progress/v1",
        journalPosition: current.events.length + 1,
        causationEventId: previousEvent?.eventId ?? null,
        recordedAt: this.clock().toISOString(),
      });
      if (progress.correlationId !== runId) {
        throw new RunIntegrityError(
          "corrupt_event",
          "Node progress must use its Run ID as the correlation ID.",
        );
      }
      const event = asEvent({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        eventId: this.eventIdFactory(),
        runId,
        sequence: current.events.length + 1,
        recordedAt: this.clock().toISOString(),
        correlationId: progress.correlationId,
        causationEventId: progress.causationEventId,
        type: "run.node-progress",
        payload: progress,
      });
      await this.commitEvent(current, event);
      return progress;
    });
  }

  /**
   * 记录一条副作用租约变更（获取/释放），原子追加事件。
   */
  async recordEffectLease(
    runIdInput: string,
    leaseInput: unknown,
  ): Promise<EffectLease> {
    const runId = runIdSchema.parse(runIdInput);

    return this.withRunWrite(runId, async () => {
      const current = await this.loadRun(runId);
      const lease = effectLeaseSchema.parse(leaseInput);
      const previousEvent = current.events.at(-1);
      const event = asEvent({
        schemaVersion: RUN_EVENT_SCHEMA_VERSION,
        eventId: this.eventIdFactory(),
        runId,
        sequence: current.events.length + 1,
        recordedAt: this.clock().toISOString(),
        correlationId: runId,
        causationEventId: previousEvent?.eventId ?? null,
        type: "run.effect-lease",
        payload: lease,
      });
      await this.commitEvent(current, event);
      return lease;
    });
  }

  /**
   * 加载 Run 清单，校验 schema 与 Run ID 匹配。
   *
   * @throws RunIntegrityError(corrupt_manifest) 清单缺失或损坏
   */
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

  /**
   * 加载并校验一次完整 Run：清单 + 日志 + 重放快照 + 产物完整性。
   *
   * 校验内容包括日志每行是合法 JSON 事件、日志以换行结尾且无空行、
   * 重放快照合法、清单请求与哈希产物一致、快照引用的所有产物存在且
   * 通过 SHA-256 校验。最后重建快照投影缓存。
   *
   * @throws RunIntegrityError 任何完整性校验失败时
   */
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

    // 日志必须以换行结尾，防止"撕裂记录"（torn record）
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
      // 校验快照引用的所有产物（请求产物除外，单独校验）存在且哈希一致
      snapshot.artifacts
        .filter((artifact) => !isDeepStrictEqual(artifact, manifest.requestArtifact))
        .map((artifact) => this.readArtifact(artifact)),
    );
    await this.repairSnapshotCache(runDirectory, snapshot);

    return { manifest, events, snapshot };
  }

  /**
   * 列出全部已创建 Run 的 ID（按字典序）。
   *
   * 只统计目录名符合 runIdSchema 的 runs/ 子目录；runs/ 或数据根目录
   * 不存在时视为空列表。
   */
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

  /**
   * 写入内容寻址产物并返回其引用（幂等：内容已存在则直接复用）。
   *
   * 先读目标路径：若已存在则校验哈希/字节数一致后直接返回，否则
   * 以"临时文件 + rename"原子写入。
   *
   * @param content 产物内容（二进制或文本）
   * @param mediaType 产物媒体类型
   * @returns 该产物的 ArtifactRef
   */
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

  /**
   * 读取内容寻址产物并校验其完整性。
   *
   * @param referenceInput 必须通过 artifactRefSchema 校验的产物引用
   * @returns 产物字节
   * @throws RunIntegrityError(corrupt_artifact) 缺失、不可读或哈希不符
   */
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

  /** 计算产物落盘路径：artifacts/<algorithm>/<hash 前两位>/<hash>。 */
  private artifactPath(reference: ArtifactRef): string {
    return path.join(
      this.dataDirectory,
      "artifacts",
      reference.algorithm,
      reference.hash.slice(0, 2),
      reference.hash,
    );
  }

  /** 计算 Run 目录路径，并顺带校验 Run ID 格式。 */
  private runDirectory(runId: string): string {
    return path.join(this.dataDirectory, "runs", runIdSchema.parse(runId));
  }

  /** 校验产物字节的字节数与会话中的 SHA-256 摘要一致。 */
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

  /**
   * 校验清单中的请求产物：媒体类型正确、内容是合法修复请求、
   * 且与其哈希的请求数据深相等（防止清单与产物不一致）。
   */
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

  /**
   * 提交事件：先追加日志行，再尽力刷新快照缓存，返回新快照。
   */
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

  /**
   * 原子写入文件：写入同目录临时文件后 rename 覆盖目标，失败时清理临时文件。
   */
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

  /** 原子地写入快照投影缓存文件。 */
  private async writeSnapshot(
    runDirectory: string,
    snapshot: RunSnapshot,
  ): Promise<void> {
    await this.atomicWrite(
      path.join(runDirectory, "snapshot.json"),
      serializeJsonLine(snapshot),
    );
  }

  /**
   * 修复快照投影缓存：若缓存与重放结果一致则跳过；若缓存领先于日志
   * （lastSequence 更大）则判定日志损坏。
   *
   * 快照只是可丢弃投影，损坏时直接由日志重建覆盖。
   */
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
      // 缓存序号领先于日志末尾，说明日志丢失了已见证过的事件
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
      // 缓存是可丢弃投影；下面以日志重排为准重建
    }

    await this.tryWriteSnapshotCache(runDirectory, snapshot);
  }

  /**
   * 尽力写入快照缓存，失败时静默吞掉。
   *
   * 事件日志已是规范事实；缓存写入失败绝不能让一次已提交的追加
   * 或一次已通过的读取变成歧义的失败。
   */
  private async tryWriteSnapshotCache(
    runDirectory: string,
    snapshot: RunSnapshot,
  ): Promise<void> {
    try {
      await this.writeSnapshot(runDirectory, snapshot);
    } catch {
      // 日志已落盘即算成功，快照缓存失败可忽略
    }
  }

  /**
   * 按 Run 串行化写操作：同一 Run 的写操作排队依次执行。
   *
   * 通过 runWriteQueues 里每个 Run 目录一个 promise 尾链实现，
   * 保证事件序号在并发调用下依然连续。
   */
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
    // 队列尾部清空后移除该键，避免 Map 无限增长
    void tail.then(() => {
      if (runWriteQueues.get(queueKey) === tail) {
        runWriteQueues.delete(queueKey);
      }
    });

    return current;
  }
}
