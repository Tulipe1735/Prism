import type {
  Budget,
  Citation,
  Delivery,
  Document,
  LocalJob,
  MemoryEntry,
  TaskEvent,
  TaskInput,
  TaskRecord,
} from "./types.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface StoreOptions {
  now?: () => Date;
  budgetCny?: number;
  infrastructureCny?: number;
}

export class AssistantStore {
  readonly directory: string;
  private readonly db: DatabaseSync;
  private readonly now: () => Date;
  private closed = false;

  constructor(directory: string, options: StoreOptions = {}) {
    this.directory = resolve(directory);
    this.now = options.now ?? (() => new Date());
    mkdirSync(join(this.directory, "documents"), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(this.directory, "workspace.sqlite"));
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        active INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS chunks (
        document_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        locator TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        PRIMARY KEY(document_id, position)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
        document_id UNINDEXED, position UNINDEXED, title, body
      );
      CREATE TABLE IF NOT EXISTS memory (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_versions (
        id TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(id, updated_at)
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS budget_policy (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spending (month TEXT PRIMARY KEY, units INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (task_id TEXT PRIMARY KEY, month TEXT NOT NULL, units INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deliveries (key TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_jobs (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, command_hash TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL,
        UNIQUE(task_id,command_hash)
      );
    `);
    this.transaction(() => {
      const existing = this.db
        .prepare("SELECT data FROM budget_policy WHERE id=1")
        .get();
      const previous = existing
        ? (JSON.parse(String(existing.data)) as {
            limit: number;
            infrastructure: number;
          })
        : { limit: 50, infrastructure: 0 };
      const policy = {
        limit: options.budgetCny ?? previous.limit,
        infrastructure: options.infrastructureCny ?? previous.infrastructure,
      };
      money(policy.limit);
      money(policy.infrastructure);
      if (policy.limit > 50)
        throw new Error("The monthly budget cannot exceed 50 CNY.");
      this.db
        .prepare(
          "INSERT INTO budget_policy VALUES (1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(JSON.stringify(policy));
    });
    // SQLite is authoritative. Rebuild readable mirrors after an interrupted write.
    this.transaction(() => {
      for (const document of this.listDocuments()) {
        if (document.active !== false) this.writeDocument(document);
        else rmSync(this.documentPath(document.id), { force: true });
      }
    });
  }

  close(): void {
    if (!this.closed) {
      this.db.close();
      this.closed = true;
    }
  }

  documentPath(id: string): string {
    return join(
      this.directory,
      "documents",
      `${createHash("sha256").update(id).digest("hex")}.md`,
    );
  }

  upsertDocument(document: Document): void {
    const current = {
      ...document,
      content: document.active === false ? "" : document.content,
      active: document.active !== false,
    };
    this.transaction(() => {
      const previous = this.getDocument(current.id);
      this.db
        .prepare(
          `INSERT INTO documents(id, data, active) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data=excluded.data, active=excluded.active`,
        )
        .run(current.id, JSON.stringify(current), current.active ? 1 : 0);
      this.db.prepare("DELETE FROM chunks WHERE document_id=?").run(current.id);
      this.db
        .prepare("DELETE FROM document_search WHERE document_id=?")
        .run(current.id);
      if (
        previous &&
        (previous.content !== current.content ||
          previous.version !== current.version ||
          !current.active)
      )
        this.invalidateMemory(current.id);
      if (!current.active) {
        rmSync(this.documentPath(current.id), { force: true });
        return;
      }
      for (const [position, chunk] of chunks(current).entries()) {
        this.db
          .prepare("INSERT INTO chunks VALUES (?, ?, ?, ?)")
          .run(current.id, position, chunk.locator, chunk.excerpt);
        this.db
          .prepare(
            "INSERT INTO document_search(document_id, position, title, body) VALUES (?, ?, ?, ?)",
          )
          .run(
            current.id,
            position,
            indexText(current.title),
            indexText(chunk.excerpt),
          );
      }
      this.writeDocument(current);
    });
  }

  getDocument(id: string): Document | undefined {
    const row = this.db
      .prepare("SELECT data FROM documents WHERE id=? AND active=1")
      .get(id);
    return row ? (JSON.parse(String(row.data)) as Document) : undefined;
  }

  listDocuments(): Document[] {
    return this.db
      .prepare("SELECT data FROM documents ORDER BY id")
      .all()
      .map((row) => JSON.parse(String(row.data)) as Document);
  }

  removeDocument(id: string): void {
    const current = this.getDocument(id);
    if (!current) return;
    this.upsertDocument({
      ...current,
      active: false,
      content: "",
      updatedAt: this.now().toISOString(),
    });
  }

  upsertMemory(entry: MemoryEntry, expectedUpdatedAt?: string): void {
    this.transaction(() => {
      const row = this.db.prepare("SELECT data FROM memory WHERE id=?").get(entry.id);
      const current = row ? (JSON.parse(String(row.data)) as MemoryEntry) : undefined;
      if (current && JSON.stringify(current) === JSON.stringify(entry)) return;
      if (current && expectedUpdatedAt !== current.updatedAt)
        throw new Error(
          "Memory conflict: read the current entry and provide its updatedAt before replacing it.",
        );
      if (!current && expectedUpdatedAt !== undefined)
        throw new Error("Memory conflict: the entry has been deleted.");
      const next: MemoryEntry = {
        ...entry,
        createdAt: current?.createdAt ?? entry.createdAt,
        updatedAt: current ? this.nextTimestamp(current.updatedAt) : entry.updatedAt,
        status: entry.sourceDocumentIds?.some((id) => !this.getDocument(id))
          ? "tentative"
          : entry.status,
      };
      this.putMemory(next);
    });
  }

  listMemory(): MemoryEntry[] {
    return this.db
      .prepare("SELECT data FROM memory ORDER BY id")
      .all()
      .map((row) => JSON.parse(String(row.data)) as MemoryEntry);
  }

  memoryHistory(id: string): MemoryEntry[] {
    return this.db
      .prepare("SELECT data FROM memory_versions WHERE id=? ORDER BY updated_at")
      .all(id)
      .map((row) => JSON.parse(String(row.data)) as MemoryEntry);
  }

  deleteMemory(id: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM memory WHERE id=?").run(id);
      this.db.prepare("DELETE FROM memory_versions WHERE id=?").run(id);
    });
  }

  createTask(input: TaskInput): TaskRecord {
    const id = input.id ?? `task_${randomUUID()}`;
    return this.transaction(() => {
      const existing = this.getTask(id);
      if (existing) return existing;
      const timestamp = this.now().toISOString();
      const task: TaskRecord = {
        ...input,
        id,
        message: input.message,
        role: input.role ?? "qa",
        effort: input.effort ?? "normal",
        conversationId: input.conversationId ?? id,
        source: input.source ?? "user",
        status: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
        answer: "",
        citations: [],
        events: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        costCny: 0,
      };
      this.db
        .prepare("INSERT INTO tasks(id,status,created_at,data) VALUES (?,?,?,?)")
        .run(id, task.status, timestamp, JSON.stringify(task));
      return task;
    });
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.data)) as TaskRecord) : undefined;
  }

  listTasks(): TaskRecord[] {
    return this.db
      .prepare("SELECT data FROM tasks ORDER BY created_at, id")
      .all()
      .map((row) => JSON.parse(String(row.data)) as TaskRecord);
  }

  updateTask(id: string, patch: Partial<TaskRecord>): TaskRecord {
    return this.transaction(() => {
      const current = this.requireTask(id);
      if (patch.id !== undefined && patch.id !== id)
        throw new Error("Task identity cannot change.");
      const task: TaskRecord = {
        ...current,
        ...patch,
        id,
        createdAt: current.createdAt,
        updatedAt: this.nextTimestamp(current.updatedAt),
        status:
          current.status === "cancelled"
            ? "cancelled"
            : (patch.status ?? current.status),
      };
      this.putTask(task);
      return task;
    });
  }

  appendEvent(id: string, event: TaskEvent): void {
    this.transaction(() => {
      const current = this.requireTask(id);
      this.putTask({
        ...current,
        updatedAt: this.nextTimestamp(current.updatedAt),
        events: [...current.events, event],
      });
    });
  }

  claimTask(id: string): boolean {
    return this.transaction(() => {
      const current = this.requireTask(id);
      if (current.status !== "queued") return false;
      this.putTask({
        ...current,
        status: "running",
        startedAt: this.now().toISOString(),
        updatedAt: this.nextTimestamp(current.updatedAt),
      });
      return true;
    });
  }

  reserveBudget(taskId: string, amountCny: number): boolean {
    const units = money(amountCny, true);
    return this.transaction(() => {
      const month = this.month();
      const previous = this.db
        .prepare("SELECT month,units FROM reservations WHERE task_id=?")
        .get(taskId);
      if (previous && previous.month !== month) return false;
      const budget = this.currentBudget(month);
      const available =
        money(budget.limitCny) -
        money(budget.infrastructureCny) -
        money(budget.spentCny) -
        money(budget.reservedCny) +
        Number(previous?.units ?? 0);
      if (units > available) return false;
      this.db
        .prepare(
          "INSERT INTO reservations(task_id,month,units) VALUES (?,?,?) ON CONFLICT(task_id) DO UPDATE SET month=excluded.month,units=excluded.units",
        )
        .run(taskId, month, units);
      return true;
    });
  }

  settleBudget(taskId: string, amountCny: number): void {
    const units = money(amountCny);
    this.transaction(() => {
      const reservation = this.db
        .prepare("SELECT month FROM reservations WHERE task_id=?")
        .get(taskId);
      if (!reservation) throw new Error(`No budget reservation for task: ${taskId}`);
      this.db
        .prepare(
          "INSERT INTO spending(month,units) VALUES (?,?) ON CONFLICT(month) DO UPDATE SET units=spending.units+excluded.units",
        )
        .run(String(reservation.month), units);
      this.db.prepare("DELETE FROM reservations WHERE task_id=?").run(taskId);
    });
  }

  releaseReservation(taskId: string): void {
    this.db.prepare("DELETE FROM reservations WHERE task_id=?").run(taskId);
  }

  settleInterruptedBudget(taskId: string): number {
    return this.transaction(() => {
      const reservation = this.db
        .prepare("SELECT month,units FROM reservations WHERE task_id=?")
        .get(taskId);
      if (!reservation) return 0;
      const units = Number(reservation.units);
      this.db
        .prepare(
          "INSERT INTO spending(month,units) VALUES (?,?) ON CONFLICT(month) DO UPDATE SET units=spending.units+excluded.units",
        )
        .run(String(reservation.month), units);
      this.db.prepare("DELETE FROM reservations WHERE task_id=?").run(taskId);
      return units / 1_000_000;
    });
  }

  budget(): Budget {
    return this.transaction(() => this.currentBudget(this.month()));
  }

  getDelivery(key: string): Delivery | undefined {
    const row = this.db.prepare("SELECT data FROM deliveries WHERE key=?").get(key);
    return row ? (JSON.parse(String(row.data)) as Delivery) : undefined;
  }

  claimDelivery(key: string, body: string): boolean {
    const timestamp = this.now().toISOString();
    const delivery: Delivery = {
      key,
      body,
      status: "pending",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return (
      this.db
        .prepare(
          "INSERT INTO deliveries(key,data) VALUES (?,?) ON CONFLICT(key) DO NOTHING",
        )
        .run(key, JSON.stringify(delivery)).changes === 1
    );
  }

  beginDelivery(key: string): boolean {
    return this.transaction(() => {
      const delivery = this.getDelivery(key);
      if (!delivery || delivery.status !== "pending" || !delivery.body.trim())
        return false;
      this.putDelivery({
        ...delivery,
        status: "unknown",
        updatedAt: this.nextTimestamp(delivery.updatedAt),
      });
      return true;
    });
  }

  updateDelivery(key: string, patch: Partial<Delivery>): void {
    this.transaction(() => {
      const current = this.getDelivery(key);
      if (!current) throw new Error(`Delivery not found: ${key}`);
      if (patch.key !== undefined && patch.key !== key)
        throw new Error("Delivery identity cannot change.");
      if (patch.body !== undefined && current.body && patch.body !== current.body)
        throw new Error("Delivery content cannot change after preparation.");
      this.putDelivery({
        ...current,
        ...patch,
        key,
        createdAt: current.createdAt,
        updatedAt: this.nextTimestamp(current.updatedAt),
      });
    });
  }

  listDeliveries(): Delivery[] {
    return this.db
      .prepare("SELECT data FROM deliveries ORDER BY key")
      .all()
      .map((row) => JSON.parse(String(row.data)) as Delivery);
  }

  enqueueLocal(taskId: string, command: Record<string, unknown>): LocalJob {
    return this.transaction(() => {
      this.requireTask(taskId);
      const commandHash = createHash("sha256").update(canonical(command)).digest("hex");
      const existing = this.db
        .prepare("SELECT data FROM local_jobs WHERE task_id=? AND command_hash=?")
        .get(taskId, commandHash);
      if (existing) return JSON.parse(String(existing.data)) as LocalJob;
      const timestamp = this.now().toISOString();
      const job: LocalJob = {
        id: `local_${randomUUID()}`,
        taskId,
        command,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.db
        .prepare(
          "INSERT INTO local_jobs(id,task_id,command_hash,status,created_at,data) VALUES (?,?,?,?,?,?)",
        )
        .run(job.id, taskId, commandHash, job.status, timestamp, JSON.stringify(job));
      return job;
    });
  }

  getLocalJob(id: string): LocalJob | undefined {
    const row = this.db.prepare("SELECT data FROM local_jobs WHERE id=?").get(id);
    return row ? (JSON.parse(String(row.data)) as LocalJob) : undefined;
  }

  approveLocal(id: string): LocalJob {
    return this.transaction(() => {
      const job = this.getLocalJob(id);
      if (!job || job.status !== "pending")
        throw new Error("Only a pending local job can be approved.");
      if (
        ["cancelled", "completed", "partial", "failed"].includes(
          this.requireTask(job.taskId).status,
        )
      )
        throw new Error("A terminal task cannot approve local operations.");
      const approved = {
        ...job,
        command: { ...job.command, approved: true },
        updatedAt: this.nextTimestamp(job.updatedAt),
      };
      this.putLocal(approved);
      return approved;
    });
  }

  claimLocal(workerId: string): LocalJob | undefined {
    return this.transaction(() => {
      const pending = this.db
        .prepare(
          "SELECT data FROM local_jobs WHERE status='pending' ORDER BY created_at,id",
        )
        .all();
      for (const row of pending) {
        const job = JSON.parse(String(row.data)) as LocalJob;
        if (job.command.approved === false) continue;
        if (this.getTask(job.taskId)?.status !== "waiting-device") continue;
        const claimed: LocalJob = {
          ...job,
          status: "claimed",
          workerId,
          updatedAt: this.nextTimestamp(job.updatedAt),
        };
        this.putLocal(claimed);
        return claimed;
      }
      return undefined;
    });
  }

  completeLocal(
    id: string,
    result: unknown,
    status: "completed" | "unknown" | "failed" = "completed",
  ): void {
    this.transaction(() => {
      const job = this.getLocalJob(id);
      if (!job) throw new Error(`Local job not found: ${id}`);
      if (job.status === status && canonical(job.result) === canonical(result)) return;
      if (job.status !== "claimed" && job.status !== "unknown")
        throw new Error("Only a claimed or unknown local job can receive a result.");
      this.putLocal({
        ...job,
        result,
        status,
        updatedAt: this.nextTimestamp(job.updatedAt),
      });
    });
  }

  private putLocal(job: LocalJob): void {
    this.db
      .prepare("UPDATE local_jobs SET status=?, data=? WHERE id=?")
      .run(job.status, JSON.stringify(job), job.id);
  }

  private putDelivery(delivery: Delivery): void {
    this.db
      .prepare("UPDATE deliveries SET data=? WHERE key=?")
      .run(JSON.stringify(delivery), delivery.key);
  }

  private month(): string {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(this.now());
    return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
  }

  private currentBudget(month: string): Budget {
    const policy = JSON.parse(
      String(this.db.prepare("SELECT data FROM budget_policy WHERE id=1").get()!.data),
    ) as { limit: number; infrastructure: number };
    const spent = Number(
      this.db.prepare("SELECT units FROM spending WHERE month=?").get(month)?.units ??
        0,
    );
    const reserved = Number(
      this.db
        .prepare(
          "SELECT COALESCE(SUM(units),0) AS units FROM reservations WHERE month=?",
        )
        .get(month)!.units,
    );
    return {
      month,
      limitCny: policy.limit,
      infrastructureCny: policy.infrastructure,
      spentCny: spent / 1_000_000,
      reservedCny: reserved / 1_000_000,
      availableCny:
        Math.max(
          0,
          money(policy.limit) - money(policy.infrastructure) - spent - reserved,
        ) / 1_000_000,
    };
  }

  private requireTask(id: string): TaskRecord {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    return task;
  }

  private putTask(task: TaskRecord): void {
    this.db
      .prepare("UPDATE tasks SET status=?, data=? WHERE id=?")
      .run(task.status, JSON.stringify(task), task.id);
  }

  private putMemory(entry: MemoryEntry): void {
    const data = JSON.stringify(entry);
    this.db
      .prepare(
        "INSERT INTO memory(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(entry.id, data);
    this.db
      .prepare("INSERT INTO memory_versions(id,updated_at,data) VALUES (?,?,?)")
      .run(entry.id, entry.updatedAt, data);
  }

  private invalidateMemory(documentId: string): void {
    for (const entry of this.listMemory()) {
      if (entry.status === "confirmed" && entry.sourceDocumentIds?.includes(documentId))
        this.putMemory({
          ...entry,
          status: "tentative",
          updatedAt: this.nextTimestamp(entry.updatedAt),
        });
    }
  }

  private nextTimestamp(previous: string): string {
    return new Date(
      Math.max(this.now().getTime(), new Date(previous).getTime() + 1),
    ).toISOString();
  }

  search(query: string, limit = 8): Citation[] {
    const tokens = [...new Set(indexText(query).split(" ").filter(Boolean))].slice(
      0,
      64,
    );
    if (!tokens.length) return [];
    const count = Math.max(1, Math.min(50, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `
      SELECT d.data, c.locator, c.excerpt FROM document_search
      JOIN chunks c ON c.document_id=document_search.document_id AND c.position=document_search.position
      JOIN documents d ON d.id=c.document_id AND d.active=1
      WHERE document_search MATCH ? ORDER BY bm25(document_search, 0, 0, 8, 1), c.position LIMIT ?
    `,
      )
      .all(tokens.map((token) => `"${token}"`).join(" OR "), count);
    return rows.map((row) => {
      const document = JSON.parse(String(row.data)) as Document;
      return {
        documentId: document.id,
        title: document.title,
        url: document.url,
        locator: String(row.locator),
        excerpt: String(row.excerpt),
        ...(document.version === undefined ? {} : { version: document.version }),
      };
    });
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private writeDocument(document: Document): void {
    const path = this.documentPath(document.id);
    const temp = `${path}.${randomUUID()}.tmp`;
    const metadata = {
      id: document.id,
      source: document.source,
      title: document.title,
      url: document.url,
      version: document.version,
      updatedAt: document.updatedAt,
      metadata: document.metadata,
    };
    writeFileSync(
      temp,
      `---\n${JSON.stringify(metadata, null, 2)}\n---\n\n${document.content}\n`,
      { mode: 0o600 },
    );
    renameSync(temp, path);
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

function money(amount: number, roundUp = false): number {
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("Money must be a finite, non-negative CNY amount.");
  const units = (roundUp ? Math.ceil : Math.round)(amount * 1_000_000);
  if (!Number.isSafeInteger(units))
    throw new Error("Money exceeds the supported range.");
  return units;
}

// FTS5's default tokenizer treats an unspaced Chinese sentence as one word.
// Bigrams make short Chinese terms searchable without an embedding service.
function indexText(text: string): string {
  const tokens: string[] = [];
  for (const word of text
    .normalize("NFKC")
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? []) {
    for (const part of word.match(/\p{Script=Han}+|\P{Script=Han}+/gu) ?? []) {
      if (/\p{Script=Han}/u.test(part)) {
        const characters = [...part];
        if (characters.length === 1) tokens.push(part);
        else
          for (let i = 0; i < characters.length - 1; i += 1)
            tokens.push(characters[i]! + characters[i + 1]!);
      } else tokens.push(part);
    }
  }
  return tokens.join(" ");
}

function chunks(document: Document): Array<{ locator: string; excerpt: string }> {
  const lines = document.content.split(/\r?\n/);
  const result: Array<{ locator: string; excerpt: string }> = [];
  let start = 1;
  let page: number | undefined;
  let text = "";
  let end = 1;
  const flush = (): void => {
    if (text.trim())
      result.push({
        locator: `${page ? `page ${page}, ` : ""}lines ${start}-${end}`,
        excerpt: text.trim(),
      });
    text = "";
  };
  for (const [index, line] of lines.entries()) {
    const pdfPage =
      document.metadata?.format === "pdf" ? /^## Page (\d+)\s*$/.exec(line) : null;
    if (pdfPage) {
      flush();
      page = Number(pdfPage[1]);
      start = index + 1;
    }
    if (line.length > 1600) {
      flush();
      for (let offset = 0; offset < line.length; offset += 1520) {
        const excerpt = line.slice(offset, offset + 1600).trim();
        if (excerpt)
          result.push({
            locator: `${page ? `page ${page}, ` : ""}lines ${index + 1}-${index + 1}`,
            excerpt,
          });
      }
      continue;
    }
    if (text.length + line.length > 1600 && text) {
      flush();
      start = index + 1;
    }
    if (!text) start = index + 1;
    end = index + 1;
    text += `${line}\n`;
  }
  flush();
  return result;
}
