import type { AssistantStore } from "./store.ts";
import type {
  AgentTool,
  Citation,
  MemoryEntry,
  Model,
  ModelMessage,
  ModelReply,
  TaskInput,
  TaskRecord,
  TaskStatus,
  ToolCall,
  Usage,
} from "./types.ts";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  RESEARCH_CANDIDATE_PROMPT,
  RESEARCH_REVIEW_PROMPT,
  RESEARCH_REVISE_PROMPT,
  rolePrompt,
} from "./prompts.ts";

const evidenceSchema = z
  .array(z.object({ documentId: z.string().min(1), quote: z.string().min(12) }))
  .min(1)
  .max(12);
const candidateSchema = z.object({
  report: z.string().min(1).max(32000),
  problem: z.string().min(1),
  methods: z
    .array(
      z.object({
        name: z.string().min(1),
        mechanism: z.string().min(1),
        assumptions: z.string().min(1),
        experiments: z.string().min(1),
        conditions: z.string().min(1),
        costs: z.string().min(1),
        limitations: z.string().min(1),
        evidence: evidenceSchema,
      }),
    )
    .min(1)
    .max(12),
  claims: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        evidence: evidenceSchema,
      }),
    )
    .min(1)
    .max(32),
  comparisonConditions: z.string().min(1),
  nextSteps: z.array(z.string().min(1)).min(1).max(16),
  gaps: z.array(z.string()).max(32),
});
const reviewSchema = z.object({
  checks: z
    .array(
      z.object({
        claimId: z.string().min(1),
        verdict: z.enum(["supported", "unsupported", "uncertain"]),
        reason: z.string().min(1),
      }),
    )
    .min(1),
  issues: z.array(z.string()).max(32),
  complete: z.boolean(),
});
const documentSchema = z.object({
  id: z.string(),
  source: z.enum(["notion", "file", "gmail", "github", "arxiv", "web", "course"]),
  title: z.string(),
  url: z.string(),
  content: z.string(),
  updatedAt: z.string(),
  active: z.boolean().optional(),
  version: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const citationSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  url: z.string(),
  locator: z.string(),
  excerpt: z.string(),
  version: z.string().optional(),
});
type ResearchCandidate = z.infer<typeof candidateSchema>;
type ResearchReview = z.infer<typeof reviewSchema>;
interface ReviewedCandidate {
  candidate: ResearchCandidate;
  review: ResearchReview;
  score: number;
}

interface RuntimeOptions {
  store: AssistantStore;
  model: Model;
  tools?: AgentTool[];
  now?: () => Date;
  normalTimeoutMs?: number;
  deepTimeoutMs?: number;
  maxRounds?: number;
  maxOutputTokens?: number;
  /** CNY per million tokens; deployment must recheck provider prices. */
  pricing?: { input: number; output: number; cacheHit?: number };
}

class TaskStop extends Error {
  readonly kind: "deadline" | "budget" | "cancelled" | "context";

  constructor(kind: "deadline" | "budget" | "cancelled" | "context", message: string) {
    super(message);
    this.kind = kind;
  }
}

function objectParameters(
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export class AssistantRuntime {
  private readonly store: AssistantStore;
  private readonly options: RuntimeOptions;
  private readonly tools = new Map<string, { tool: AgentTool; schema: z.ZodType }>();
  private readonly running = new Map<
    string,
    { controller: AbortController; promise: Promise<TaskRecord> }
  >();

  constructor(options: RuntimeOptions) {
    this.options = options;
    this.store = options.store;
    const prices = options.pricing ?? { input: 10, output: 30 };
    for (const price of [
      prices.input,
      prices.output,
      prices.cacheHit ?? prices.input,
    ]) {
      if (!Number.isFinite(price) || price < 0)
        throw new Error("Invalid model pricing");
    }
    for (const tool of [...this.builtinTools(), ...(options.tools ?? [])]) {
      const name = tool.definition.name;
      if (this.tools.has(name)) throw new Error(`Duplicate tool ${name}`);
      const schema = z.fromJSONSchema(
        tool.definition.parameters as Parameters<typeof z.fromJSONSchema>[0],
      );
      this.tools.set(name, { tool, schema });
    }
  }

  submit(input: TaskInput): TaskRecord {
    if (!input.message.trim()) throw new Error("Task message is required");
    const task = this.store.createTask(input);
    if (input.confirmedMemoryIds?.length && !task.confirmedMemoryIds)
      return this.store.updateTask(task.id, {
        confirmedMemoryIds: [...input.confirmedMemoryIds],
      });
    return task;
  }

  ask(input: TaskInput): Promise<TaskRecord> {
    return this.run(this.submit(input).id);
  }

  get(id: string): TaskRecord | undefined {
    return this.store.getTask(id);
  }

  run(id: string): Promise<TaskRecord> {
    const active = this.running.get(id);
    if (active) return active.promise;
    const task = this.get(id);
    if (!task) return Promise.reject(new Error(`Unknown task ${id}`));
    if (
      task.effort === "deep" &&
      task.deadlineAt &&
      Date.parse(task.deadlineAt) <= this.now().getTime()
    )
      return Promise.resolve(this.expire(id));
    if (!this.store.claimTask(id)) return Promise.resolve(this.get(id)!);
    if (task.startedAt) this.store.updateTask(id, { startedAt: task.startedAt });
    const controller = new AbortController();
    const entry = { controller, promise: Promise.resolve(task) };
    this.running.set(id, entry);
    entry.promise = this.execute(id, controller).finally(() => this.running.delete(id));
    return entry.promise;
  }

  expire(id: string): TaskRecord {
    const task = this.get(id);
    if (!task) throw new Error(`Unknown task ${id}`);
    if (
      task.effort !== "deep" ||
      !task.deadlineAt ||
      Date.parse(task.deadlineAt) > this.now().getTime() ||
      ["completed", "partial", "failed", "cancelled"].includes(task.status)
    )
      return task;
    const active = this.running.get(id);
    if (active) {
      active.controller.abort(new TaskStop("deadline", "达到任务时间上限"));
      return this.get(id)!;
    }
    return this.finish(id, "partial", "达到任务时间上限；已停止新增工作，保留当前成果");
  }

  cancel(id: string): TaskRecord {
    const task = this.get(id);
    if (!task) throw new Error(`Unknown task ${id}`);
    if (
      !["queued", "running", "waiting-device", "awaiting-confirmation"].includes(
        task.status,
      )
    )
      return task;
    this.running.get(id)?.controller.abort(new TaskStop("cancelled", "用户取消任务"));
    if (!this.running.has(id)) this.store.releaseReservation(id);
    this.event(id, "cancelled", "用户取消任务；停止新增工作");
    return this.store.updateTask(id, {
      status: "cancelled",
      error: "用户取消任务",
      updatedAt: this.now().toISOString(),
    });
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private event(id: string, kind: string, message: string): void {
    this.store.appendEvent(id, { at: this.now().toISOString(), kind, message });
  }

  private check(signal: AbortSignal, deadline: number): void {
    signal.throwIfAborted();
    if (this.now().getTime() >= deadline)
      throw new TaskStop("deadline", "达到任务时间上限");
  }

  private async execute(id: string, controller: AbortController): Promise<TaskRecord> {
    const task = this.get(id)!;
    const timeout = Math.min(
      task.effort === "deep"
        ? (this.options.deepTimeoutMs ?? 1_200_000)
        : (this.options.normalTimeoutMs ?? 120_000),
      1_200_000,
    );
    const deadline =
      task.effort === "deep" && task.deadlineAt
        ? Date.parse(task.deadlineAt)
        : this.now().getTime() + timeout;
    const timer = setTimeout(
      () => controller.abort(new TaskStop("deadline", "达到任务时间上限")),
      Math.max(0, deadline - this.now().getTime()),
    );
    try {
      const messages = this.refreshMessages(
        task,
        task.messages?.length ? task.messages : this.initialMessages(task),
      );
      let phase: "solve" | "check" | "revise" = "solve";
      let candidate: ResearchCandidate | undefined;
      let best: ReviewedCandidate | undefined;
      if (task.effort === "deep") {
        const bestPath = join(this.artifactDirectory(id), "best.json");
        if (existsSync(bestPath)) {
          const saved = z
            .object({
              candidate: candidateSchema,
              review: reviewSchema,
              score: z.number(),
            })
            .safeParse(JSON.parse(readFileSync(bestPath, "utf8")));
          if (saved.success) best = saved.data;
        }
        messages.push({ role: "user", content: RESEARCH_CANDIDATE_PROMPT });
        this.event(id, "research-solve", "正在查找来源和可比较的方法路线");
      }
      this.store.updateTask(id, {
        startedAt: task.startedAt ?? this.now().toISOString(),
        deadlineAt: new Date(deadline).toISOString(),
        messages,
      });
      this.event(
        id,
        "started",
        `开始${task.effort === "deep" ? "深入研究" : "问答"}；费用按配置单价估算`,
      );
      for (let round = 0; round < (this.options.maxRounds ?? 16); round++) {
        this.check(controller.signal, deadline);
        this.event(id, "model", `正在推进任务，第 ${round + 1} 轮`);
        const reply = await this.request(id, messages, controller.signal);
        this.check(controller.signal, deadline);
        messages.push(reply.message);
        this.store.updateTask(id, { messages });
        if (reply.message.tool_calls?.length) {
          for (const [callIndex, call] of reply.message.tool_calls.entries()) {
            this.check(controller.signal, deadline);
            const result = await this.callTool(id, call, controller.signal);
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
            this.store.updateTask(id, { messages });
            if (
              result &&
              typeof result === "object" &&
              "status" in result &&
              (result.status === "waiting-device" ||
                result.status === "awaiting-confirmation")
            ) {
              for (const deferred of reply.message.tool_calls.slice(callIndex + 1))
                messages.push({
                  role: "tool",
                  tool_call_id: deferred.id,
                  content: JSON.stringify({
                    status: "not_executed",
                    reason:
                      "Task paused before execution. Request this tool again only after reviewing the local outcome.",
                  }),
                });
              this.store.updateTask(id, { messages });
              return this.finish(
                id,
                result.status,
                "等待本地设备或用户确认；任务尚未完成",
              );
            }
          }
          continue;
        }
        const answer = reply.message.content?.trim();
        if (!answer) throw new Error("模型未交付成果");
        if (reply.finishReason && reply.finishReason !== "stop") {
          if (task.effort !== "deep") this.store.updateTask(id, { answer });
          return this.finish(id, "partial", `模型停止：${reply.finishReason}`);
        }
        if (task.effort === "deep") {
          try {
            if (phase !== "check") {
              candidate = candidateSchema.parse(JSON.parse(answer));
              this.verifyCandidate(id, candidate);
              this.saveArtifact(
                id,
                `candidate-${round + 1}.json`,
                JSON.stringify(candidate, null, 2),
              );
              if (!best)
                this.store.updateTask(id, {
                  answer: `${candidate.report}\n\n检查尚未完成；以上为有来源的候选成果。`,
                });
              phase = "check";
              messages.push({ role: "user", content: RESEARCH_REVIEW_PROMPT });
              this.event(
                id,
                "research-check",
                "已保存候选成果，正在核对结论和比较条件",
              );
            } else {
              const review = reviewSchema.parse(JSON.parse(answer));
              if (
                !candidate ||
                new Set(candidate.claims.map((claim) => claim.id)).size !==
                  candidate.claims.length ||
                review.checks.length !== candidate.claims.length ||
                new Set(review.checks.map((check) => check.claimId)).size !==
                  review.checks.length ||
                review.checks.some(
                  (check) =>
                    !candidate!.claims.some((claim) => claim.id === check.claimId),
                )
              )
                throw new Error("Review must check each candidate claim exactly once");
              this.verifyCandidate(id, candidate);
              const distinctMethods = new Set(
                candidate.methods.map((method) => method.name.toLowerCase().trim()),
              ).size;
              const supported = review.checks.filter(
                (check) => check.verdict === "supported",
              ).length;
              const complete =
                review.complete &&
                !review.issues.length &&
                supported === candidate.claims.length &&
                distinctMethods >= 2;
              const score =
                (complete ? 1000 : 0) +
                (supported / candidate.claims.length) * 100 +
                Math.min(distinctMethods, 3) * 10 -
                Math.min(review.issues.length, 10);
              this.saveArtifact(
                id,
                `review-${round + 1}.json`,
                JSON.stringify(review, null, 2),
              );
              if (!best || score > best.score) {
                best = { candidate, review, score };
                this.saveArtifact(id, "best.json", JSON.stringify(best, null, 2));
                this.store.updateTask(id, { answer: this.researchReport(best) });
                this.event(
                  id,
                  "candidate-selected",
                  "已保留当前证据支持、方法覆盖和检查结果较好的成果",
                );
              } else {
                this.event(
                  id,
                  "candidate-retained",
                  "本轮没有改善证据支持和方法覆盖，保留已有较好成果",
                );
              }
              if (complete) return this.finish(id, "completed");
              phase = "revise";
              messages.push({ role: "user", content: RESEARCH_REVISE_PROMPT });
              this.event(
                id,
                "research-revise",
                "根据实际检查问题修订；保留已有较好成果",
              );
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.event(
              id,
              "research-invalid",
              `未接受不完整或无法核对的研究产物：${reason}`,
            );
            messages.push({
              role: "user",
              content: `The ${phase === "check" ? "review" : "candidate"} was rejected: ${reason}. Correct the structured output using actual tool evidence. Do not fabricate citations.`,
            });
          }
          this.store.updateTask(id, { messages });
          continue;
        }
        this.store.updateTask(id, { answer });
        return this.finish(id, "completed");
      }
      return this.finish(id, "partial", "达到模型调用轮次上限");
    } catch (error) {
      const stopped = error instanceof TaskStop;
      const reason = error instanceof Error ? error.message : String(error);
      const status = stopped
        ? error.kind === "cancelled"
          ? "cancelled"
          : "partial"
        : this.get(id)!.answer
          ? "partial"
          : "failed";
      return this.finish(id, status, reason);
    } finally {
      clearTimeout(timer);
      this.store.releaseReservation(id);
    }
  }

  private initialMessages(task: TaskRecord): ModelMessage[] {
    const history = this.store
      .listTasks()
      .filter(
        (previous) =>
          previous.id !== task.id &&
          previous.role === task.role &&
          previous.conversationId === task.conversationId &&
          previous.answer &&
          previous.citations.every((citation) => this.currentCitation(citation)) &&
          ["completed", "partial"].includes(previous.status),
      )
      .slice(-4);
    return [
      { role: "system", content: this.systemContext(task) },
      ...history.flatMap((previous) => [
        { role: "user" as const, content: previous.message.slice(0, 4000) },
        { role: "assistant" as const, content: previous.answer.slice(0, 8000) },
      ]),
      { role: "user", content: task.message },
    ];
  }

  private selectedMemory(task: TaskRecord): MemoryEntry[] {
    const entries = this.store
      .listMemory()
      .filter((entry) =>
        (entry.sourceDocumentIds ?? []).every((id) => {
          const document = this.store.getDocument(id);
          return document != null && document.active !== false;
        }),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const terms =
      task.message.toLowerCase().match(/[a-z][a-z0-9_-]{2,}|\p{Script=Han}{2}/gu) ?? [];
    const current = ["progress", "preference", "correction", "question"].flatMap(
      (kind) =>
        entries
          .filter((entry) => entry.kind === kind && entry.status === "confirmed")
          .slice(0, 2),
    );
    const relevant = entries
      .filter((entry) => terms.some((term) => entry.text.toLowerCase().includes(term)))
      .slice(0, 6);
    return [
      ...new Map([...current, ...relevant].map((entry) => [entry.id, entry])).values(),
    ]
      .slice(0, 12)
      .map((entry) => ({
        ...entry,
        text: entry.text.slice(0, 1800),
        sourceDocumentIds: entry.sourceDocumentIds?.slice(0, 8),
      }));
  }

  private currentCitation(citation: Citation): boolean {
    const document = this.store.getDocument(citation.documentId);
    return (
      document != null &&
      document.active !== false &&
      document.version === citation.version &&
      document.url === citation.url &&
      document.content.includes(citation.excerpt)
    );
  }

  private systemContext(task: TaskRecord): string {
    return `${rolePrompt(task.role)}\nCurrent shared research state, refreshed from durable storage (bounded current confirmed progress/preferences/corrections plus task-relevant evidence):\n${JSON.stringify(this.selectedMemory(task))}\nRespect status and provenance. Tentative entries are not user confirmations. This current snapshot supersedes historical memory references; withdrawn or superseded rules in earlier messages are not active instructions. Retrieve additional relevant state with memory_list when needed.`;
  }

  private refreshMessages(task: TaskRecord, previous: ModelMessage[]): ModelMessage[] {
    const memory = new Map(this.store.listMemory().map((entry) => [entry.id, entry]));
    const toolNames = new Map(
      previous.flatMap((message) =>
        (message.tool_calls ?? []).map(
          (call) => [call.id, call.function.name] as const,
        ),
      ),
    );
    const messages = previous
      .filter((message) => message.role !== "system")
      .map((message) => {
        if (message.role !== "tool" || !message.tool_call_id) return { ...message };
        const name = toolNames.get(message.tool_call_id);
        if (name === "memory_list")
          return {
            ...message,
            content: JSON.stringify({
              refreshed: true,
              entries: this.selectedMemory(task),
            }),
          };
        if (name === "memory_update" && message.content) {
          try {
            const result = z
              .object({ id: z.string() })
              .safeParse(JSON.parse(message.content));
            if (result.success)
              return {
                ...message,
                content: JSON.stringify(
                  memory.get(result.data.id) ?? {
                    id: result.data.id,
                    withdrawn: true,
                    note: "This memory is no longer active.",
                  },
                ),
              };
          } catch {
            /* Failed historical tool results stay visible as errors. */
          }
        }
        return { ...message };
      });
    return [{ role: "system", content: this.systemContext(task) }, ...messages];
  }

  private price(usage: Usage): number {
    const p = this.options.pricing ?? { input: 10, output: 30 };
    const hits = Math.min(usage.cacheHitTokens ?? 0, usage.inputTokens);
    return (
      Math.ceil(
        (usage.inputTokens - hits) * p.input +
          hits * (p.cacheHit ?? p.input) +
          usage.outputTokens * p.output,
      ) / 1_000_000
    );
  }

  private async request(
    id: string,
    messages: ModelMessage[],
    signal: AbortSignal,
  ): Promise<ModelReply> {
    const definitions = [...this.tools.values()].map(({ tool }) => tool.definition);
    const bytes = Buffer.byteLength(
      JSON.stringify({ messages, tools: definitions }),
      "utf8",
    );
    if (bytes > 96_000)
      throw new TaskStop("context", "当前任务上下文达到限制，保留已有成果");
    const maxOutputTokens = this.options.maxOutputTokens ?? 4096;
    const reservation = this.price({
      inputTokens: bytes + messages.length * 64 + 512,
      outputTokens: maxOutputTokens,
    });
    if (!this.store.reserveBudget(id, reservation))
      throw new TaskStop("budget", "模型可用预算不足，停止新增付费调用");
    let usage: Usage | undefined;
    try {
      const reply = await abortable(
        this.options.model.complete(messages, definitions, { signal, maxOutputTokens }),
        signal,
      );
      usage = reply.usage;
      return reply;
    } catch (error) {
      if (error && typeof error === "object" && "usage" in error)
        usage = z
          .object({
            inputTokens: z.number().nonnegative(),
            outputTokens: z.number().nonnegative(),
            cacheHitTokens: z.number().nonnegative().optional(),
          })
          .safeParse(error.usage).data;
      throw error;
    } finally {
      const cost = usage ? this.price(usage) : reservation;
      this.store.settleBudget(id, cost);
      const task = this.get(id)!;
      this.store.updateTask(id, {
        costCny: Math.round((task.costCny + cost) * 1_000_000) / 1_000_000,
        usage: usage
          ? {
              inputTokens: task.usage.inputTokens + usage.inputTokens,
              outputTokens: task.usage.outputTokens + usage.outputTokens,
              cacheHitTokens:
                (task.usage.cacheHitTokens ?? 0) + (usage.cacheHitTokens ?? 0),
            }
          : task.usage,
      });
      if (!usage)
        this.event(
          id,
          "cost-estimate",
          "请求已发起但未取得有效用量；按预占上界计入估算费用，避免低估未知账单",
        );
    }
  }

  private async callTool(
    id: string,
    call: ToolCall,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      const registered = this.tools.get(call.function.name);
      if (!registered) throw new Error(`Unknown tool ${call.function.name}`);
      const raw: unknown = JSON.parse(call.function.arguments);
      const args = registered.schema.parse(raw);
      const record = z.record(z.string(), z.unknown()).parse(args);
      this.event(id, "tool-started", `正在运行工具 ${call.function.name}`);
      const result = await abortable(
        registered.tool.execute(record, {
          taskId: id,
          role: this.get(id)!.role,
          signal,
        }),
        signal,
      );
      signal.throwIfAborted();
      if (call.function.name !== "document_read") this.captureSources(id, result);
      this.event(id, "tool", `已完成工具 ${call.function.name}`);
      const serialized = JSON.stringify(result ?? null);
      return serialized.length > 32000
        ? {
            truncated: true,
            preview: serialized.slice(0, 28000),
            note: "Tool output truncated. Use document_read with an imported document ID to read specific chunks.",
          }
        : (result ?? null);
    } catch (error) {
      signal.throwIfAborted();
      const message = error instanceof Error ? error.message : String(error);
      this.event(id, "tool-error", `${call.function.name}：${message}`);
      return { error: message };
    }
  }

  private finish(id: string, status: TaskStatus, reason?: string): TaskRecord {
    const task = this.get(id)!;
    const finalStatus = task.status === "cancelled" ? "cancelled" : status;
    const answer = task.answer.split("\n\n---\n任务状态：")[0]!;
    const report = `${answer || "尚未形成有依据的成果。"}${reason ? `\n\n---\n任务状态：${finalStatus}。${reason}。` : ""}`;
    const path = this.saveArtifact(id, "report.md", report);
    this.event(id, finalStatus, reason ?? "任务成果已保存");
    return this.store.updateTask(id, {
      status: finalStatus,
      answer: report,
      error: reason,
      artifacts: [...new Set([path, ...(task.artifacts ?? [])])],
      updatedAt: this.now().toISOString(),
    });
  }

  private artifactDirectory(id: string): string {
    return join(
      this.store.directory,
      "tasks",
      createHash("sha256").update(id).digest("hex").slice(0, 24),
    );
  }

  private saveArtifact(id: string, name: string, content: string): string {
    const directory = this.artifactDirectory(id);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, name);
    writeFileSync(path, content, "utf8");
    const task = this.get(id)!;
    this.store.updateTask(id, {
      artifacts: [...new Set([...(task.artifacts ?? []), path])],
    });
    return path;
  }

  private verifyCandidate(id: string, candidate: ResearchCandidate): void {
    const read = this.get(id)!.citations;
    for (const evidence of [
      ...candidate.claims.flatMap((claim) => claim.evidence),
      ...candidate.methods.flatMap((method) => method.evidence),
    ]) {
      const source = this.store.getDocument(evidence.documentId);
      if (
        !source ||
        source.active === false ||
        !read.some(
          (citation) =>
            citation.documentId === evidence.documentId &&
            citation.excerpt.includes(evidence.quote),
        ) ||
        !source.content.includes(evidence.quote)
      )
        throw new Error(`Unverified or unread quotation from ${evidence.documentId}`);
    }
  }

  private captureSources(id: string, result: unknown, depth = 0): void {
    if (depth > 4 || result == null || typeof result !== "object") return;
    if (Array.isArray(result)) {
      for (const value of result.slice(0, 24))
        this.captureSources(id, value, depth + 1);
      return;
    }
    const document = documentSchema.safeParse(result);
    let citation: Citation | undefined;
    if (document.success && document.data.active !== false) {
      const source = document.data;
      this.store.upsertDocument(source);
      citation = {
        documentId: source.id,
        title: source.title,
        url: source.url,
        locator: "characters 1–12000",
        excerpt: source.content.slice(0, 12000),
        version: source.version,
      };
    } else {
      const parsed = citationSchema.safeParse(result);
      if (
        parsed.success &&
        this.store
          .getDocument(parsed.data.documentId)
          ?.content.includes(parsed.data.excerpt)
      )
        citation = parsed.data;
    }
    if (citation) {
      const current = this.get(id)!;
      if (
        !current.citations.some(
          (value) =>
            value.documentId === citation.documentId &&
            value.locator === citation.locator,
        )
      )
        this.store.updateTask(id, { citations: [...current.citations, citation] });
      return;
    }
    const values = z.record(z.string(), z.unknown()).parse(result);
    for (const key of [
      "documents",
      "document",
      "citations",
      "citation",
      "results",
      "items",
    ])
      this.captureSources(id, values[key], depth + 1);
  }

  private researchReport(best: ReviewedCandidate): string {
    const { candidate, review } = best;
    const sources = [
      ...new Set(
        candidate.claims.flatMap((claim) =>
          claim.evidence.map((evidence) => evidence.documentId),
        ),
      ),
    ]
      .map((id) => this.store.getDocument(id))
      .filter((source) => source != null);
    return `${candidate.report}\n\n来源：\n${sources.map((source) => `- [${source.title}](${source.url})`).join("\n")}\n\n比较条件：${candidate.comparisonConditions}\n\n下一步：\n${candidate.nextSteps.map((step) => `- ${step}`).join("\n")}${candidate.gaps.length || review.issues.length ? `\n\n未解决部分：\n${[...candidate.gaps, ...review.issues].map((gap) => `- ${gap}`).join("\n")}` : ""}${review.checks.some((check) => check.verdict !== "supported") ? "\n\n部分结论未获检查支持，不应视为已验证结论。" : ""}`;
  }

  private builtinTools(): AgentTool[] {
    return [
      {
        definition: {
          name: "library_search",
          description:
            "Search active source material; returned citations point to source locations.",
          parameters: objectParameters(
            {
              query: { type: "string", minLength: 1 },
              limit: { type: "integer", minimum: 1, maximum: 12 },
            },
            ["query"],
          ),
        },
        execute: async (args, context) => {
          const citations = this.store.search(
            String(args.query),
            args.limit == null ? 8 : Number(args.limit),
          );
          const current = this.get(context.taskId)!;
          const unique = new Map(
            [...current.citations, ...citations].map((citation) => [
              `${citation.documentId}:${citation.locator}`,
              citation,
            ]),
          );
          this.store.updateTask(context.taskId, { citations: [...unique.values()] });
          return citations;
        },
      },
      {
        definition: {
          name: "document_read",
          description:
            "Read an active imported document by ID. Offset and limit locate the exact text chunk; attachment links do not mean their content was read.",
          parameters: objectParameters(
            {
              id: { type: "string", minLength: 1 },
              offset: { type: "integer", minimum: 0 },
              limit: { type: "integer", minimum: 1, maximum: 20000 },
            },
            ["id"],
          ),
        },
        execute: async (args, context) => {
          const doc = this.store.getDocument(String(args.id));
          if (!doc || doc.active === false)
            throw new Error("Document unavailable or access revoked");
          const offset = Number(args.offset ?? 0);
          const content = doc.content.slice(
            offset,
            offset + Number(args.limit ?? 12000),
          );
          const citation: Citation = {
            documentId: doc.id,
            title: doc.title,
            url: doc.url,
            locator: `characters ${offset + 1}–${offset + content.length}`,
            excerpt: content,
            version: doc.version,
          };
          const current = this.get(context.taskId)!;
          this.store.updateTask(context.taskId, {
            citations: [
              ...current.citations.filter(
                (value) =>
                  value.documentId !== doc.id || value.locator !== citation.locator,
              ),
              citation,
            ],
          });
          return {
            ...doc,
            content,
            offset,
            hasMore: offset + content.length < doc.content.length,
            citation,
          };
        },
      },
      {
        definition: {
          name: "memory_list",
          description:
            "Read shared research progress, corrections, reading records and learning evidence; tentative is not user confirmed.",
          parameters: objectParameters({}),
        },
        execute: async () =>
          this.store.listMemory().map((entry) => {
            const unavailableSourceIds = (entry.sourceDocumentIds ?? []).filter(
              (id) => !this.store.getDocument(id),
            );
            return {
              ...entry,
              needsReview:
                entry.status === "tentative" || unavailableSourceIds.length > 0,
              unavailableSourceIds,
            };
          }),
      },
      {
        definition: {
          name: "memory_update",
          description:
            "Save a sourced research memory or correction. New ideas are tentative. Confirmed status can only promote an unchanged entry explicitly confirmed by the user interface.",
          parameters: objectParameters(
            {
              id: { type: "string", minLength: 1 },
              kind: {
                type: "string",
                enum: [
                  "progress",
                  "question",
                  "preference",
                  "correction",
                  "experience",
                  "reading",
                  "course",
                ],
              },
              text: { type: "string", minLength: 1, maxLength: 8000 },
              status: { type: "string", enum: ["confirmed", "tentative"] },
              sourceDocumentIds: { type: "array", items: { type: "string" } },
            },
            ["id", "kind", "text", "status"],
          ),
        },
        execute: async (args, context) => {
          const existing = this.store
            .listMemory()
            .find((entry) => entry.id === args.id);
          const task = this.get(context.taskId)!;
          const confirmed = task.confirmedMemoryIds?.includes(String(args.id));
          const unchanged =
            existing &&
            existing.text === args.text &&
            existing.kind === args.kind &&
            JSON.stringify(existing.sourceDocumentIds ?? []) ===
              JSON.stringify(args.sourceDocumentIds ?? []);
          if (
            (args.status === "confirmed" && (!confirmed || !unchanged)) ||
            (existing?.status === "confirmed" && !confirmed && !unchanged)
          )
            throw new Error(
              "Explicit user confirmation of this exact memory content is required",
            );
          const sourceDocumentIds = z
            .array(z.string())
            .parse(args.sourceDocumentIds ?? []);
          if (sourceDocumentIds.some((sourceId) => !this.store.getDocument(sourceId)))
            throw new Error("Memory source unavailable or access revoked");
          const at = this.now().toISOString();
          const entry: MemoryEntry = {
            id: String(args.id),
            kind: args.kind as MemoryEntry["kind"],
            text: String(args.text),
            status: args.status as MemoryEntry["status"],
            sourceTaskId: context.taskId,
            sourceDocumentIds,
            createdAt: existing?.createdAt ?? at,
            updatedAt: at,
          };
          this.store.upsertMemory(entry, existing?.updatedAt);
          return entry;
        },
      },
      {
        definition: {
          name: "memory_delete",
          description:
            "Delete shared memory when the user explicitly asks to remove it.",
          parameters: objectParameters({ id: { type: "string", minLength: 1 } }, [
            "id",
          ]),
        },
        execute: async (args) => {
          this.store.deleteMemory(String(args.id));
          return { deleted: String(args.id) };
        },
      },
    ];
  }
}
