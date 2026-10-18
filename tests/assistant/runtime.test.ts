import type { Citation, Document, ModelMessage, TaskEvent, TaskInput, TaskRecord } from "../../src/assistant/types.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DeepSeekModel } from "../../src/assistant/deepseek.ts";
import { AssistantRuntime } from "../../src/assistant/runtime.ts";

// Temporary public persistence fixture until the parallel Store implementation is merged.
class AssistantStore {
  tasks = new Map<string, TaskRecord>();
  documents = new Map<string, Document>();
  reservedCny = 0;
  spentCny = 0;
  constructor(readonly directory: string, readonly options: { budgetCny: number; infrastructureCny: number }) {}
  close() {}
  createTask(input: TaskInput): TaskRecord {
    const id = input.id ?? `task-${this.tasks.size}`;
    const task: TaskRecord = { id, message: input.message, role: input.role ?? "qa", effort: input.effort ?? "normal", conversationId: input.conversationId ?? id, source: input.source ?? "test", status: "queued", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), answer: "", citations: [], events: [], usage: { inputTokens: 0, outputTokens: 0 }, costCny: 0 };
    this.tasks.set(id, task); return task;
  }
  getTask(id: string) { return this.tasks.get(id); }
  listTasks() { return [...this.tasks.values()]; }
  updateTask(id: string, patch: Partial<TaskRecord>) { const task = { ...this.tasks.get(id)!, ...patch }; this.tasks.set(id, task); return task; }
  appendEvent(id: string, event: TaskEvent) { this.updateTask(id, { events: [...this.tasks.get(id)!.events, event] }); }
  claimTask(id: string) { if (this.getTask(id)?.status !== "queued") return false; this.updateTask(id, { status: "running" }); return true; }
  reserveBudget(_id: string, amount: number) { if (this.options.budgetCny - this.options.infrastructureCny - this.spentCny < amount) return false; this.reservedCny = amount; return true; }
  settleBudget(_id: string, amount: number) { this.spentCny += amount; this.reservedCny = 0; }
  releaseReservation() { this.reservedCny = 0; }
  budget() { return { spentCny: this.spentCny, reservedCny: this.reservedCny }; }
  upsertDocument(document: Document) { this.documents.set(document.id, document); }
  getDocument(id: string) { return this.documents.get(id); }
  search(): Citation[] { return [...this.documents.values()].map(document => ({ documentId: document.id, title: document.title, url: document.url, locator: "paragraph 1", excerpt: document.content })); }
}

const directories: string[] = [];
const stores: AssistantStore[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function candidate(report: string, twoMethods = true) {
  const evidence = [{ documentId: "seed", quote: "Scene programs construct training environments." }];
  const method = { name: "Scene programs", mechanism: "Construct scenes with code", assumptions: "Simulation supports program execution", experiments: "A fixed task set", conditions: "Task sets differ, so scores are not directly comparable", costs: "Training cost is not reported", limitations: "Simulation transfer is uncertain", evidence };
  return { report, problem: "Generate training environments", methods: twoMethods ? [method, { ...method, name: "Template scenes", mechanism: "Reuse authored templates" }] : [method], claims: [{ id: "claim-build", text: "Scene programs construct training environments.", evidence }], comparisonConditions: "Different evaluation tasks prevent ranking raw scores.", nextSteps: ["Compare both methods on the same task set."], gaps: ["Compute cost is not reported."] };
}

it("checks and revises deep research, retaining the better grounded comparison when a longer revision loses method coverage", async () => {
  const store = openStore();
  store.upsertDocument({ id: "seed", source: "arxiv", title: "Evidence", url: "https://example.org/paper", content: "Scene programs construct training environments.", updatedAt: new Date().toISOString() });
  const review = { checks: [{ claimId: "claim-build", verdict: "supported", reason: "The quoted original source supports this statement." }], issues: ["Resource cost needs more evidence."], complete: false };
  const fixture = apiFixture([
    { message: { role: "assistant", content: null, tool_calls: [{ id: "evidence", type: "function", function: { name: "document_read", arguments: '{"id":"seed"}' } }] } },
    { message: { role: "assistant", content: JSON.stringify(candidate("The original comparison retains both methods.")) } },
    { message: { role: "assistant", content: JSON.stringify(review) } },
    { message: { role: "assistant", content: JSON.stringify(candidate(`A much longer but narrower revision. ${"Extra prose. ".repeat(150)}`, false)) } },
    { message: { role: "assistant", content: JSON.stringify(review) } },
  ]);
  const runtime = new AssistantRuntime({ store, model: fixture.model, maxRounds: 5, pricing: { input: 2, output: 3 } });
  const result = await runtime.ask({ message: "Compare approaches to generating training environments", effort: "deep" });
  expect(result.answer).toContain("The original comparison retains both methods.");
  expect(result.answer).not.toContain("A much longer but narrower revision");
  expect(result.status).toBe("partial");
  expect(result.events.map(event => event.kind)).toEqual(expect.arrayContaining(["research-solve", "research-check", "research-revise", "candidate-retained"]));
});

function openStore(budgetCny = 50) {
  const directory = mkdtempSync(join(tmpdir(), "prism-runtime-"));
  directories.push(directory);
  const store = new AssistantStore(directory, { budgetCny, infrastructureCny: 10 });
  stores.push(store);
  return store;
}

function apiFixture(replies: Array<{ message: ModelMessage; usage?: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number } }>) {
  const requests: Array<{ messages: ModelMessage[]; model: string; max_tokens: number; tools: unknown[] }> = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected paid provider request in fixture");
    return new Response(JSON.stringify({ choices: [{ message: reply.message, finish_reason: reply.message.tool_calls?.length ? "tool_calls" : "stop" }], usage: reply.usage ?? { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 20 } }));
  });
  return { model: new DeepSeekModel({ apiKey: "fixture-only", model: "deepseek-flash", fetch }), requests, fetch };
}

it("answers from source material, preserves tool reasoning, and records usage and a readable report", async () => {
  const store = openStore();
  store.upsertDocument({ id: "seed", source: "arxiv", title: "Verified paper", url: "https://arxiv.org/abs/2605.09423", content: "Scene programs construct training environments. Evaluation uses a fixed set of tasks.", updatedAt: new Date().toISOString() });
  const fixture = apiFixture([
    { message: { role: "assistant", content: null, reasoning_content: "Retrieve the relevant evidence.", tool_calls: [{ id: "call-source", type: "function", function: { name: "library_search", arguments: '{"query":"training environments"}' } }] } },
    { message: { role: "assistant", content: "Scene programs construct training environments. [Verified paper](https://arxiv.org/abs/2605.09423)" } },
  ]);
  const runtime = new AssistantRuntime({ store, model: fixture.model, pricing: { input: 2, output: 3, cacheHit: 0.2 } });
  const result = await runtime.ask({ message: "What does the paper build?", conversationId: "research" });
  expect(result.status).toBe("completed");
  expect(result.citations).toEqual([expect.objectContaining({ documentId: "seed", excerpt: expect.stringContaining("training environments") })]);
  expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 100, cacheHitTokens: 40 });
  expect(result.costCny).toBeCloseTo(0.000628, 6);
  expect(store.budget()).toMatchObject({ reservedCny: 0, spentCny: result.costCny });
  expect(readFileSync(result.artifacts![0]!, "utf8")).toContain("Scene programs");
  expect(fixture.requests[1]?.messages).toContainEqual(expect.objectContaining({ reasoning_content: "Retrieve the relevant evidence.", tool_calls: [expect.objectContaining({ id: "call-source" })] }));
});

it("rejects invalid external tool arguments and retains citations from a valid source read", async () => {
  const store = openStore();
  const executed: string[] = [];
  const fixture = apiFixture([
    { message: { role: "assistant", content: null, tool_calls: [{ id: "invalid", type: "function", function: { name: "paper_read", arguments: '{"url":17}' } }] } },
    { message: { role: "assistant", content: null, tool_calls: [{ id: "valid", type: "function", function: { name: "paper_read", arguments: '{"url":"https://example.org/original"}' } }] } },
    { message: { role: "assistant", content: "The original method uses code. [Source](https://example.org/original)" } },
  ]);
  const runtime = new AssistantRuntime({ store, model: fixture.model, tools: [{ definition: { name: "paper_read", description: "Read a paper", parameters: { type: "object", properties: { url: { type: "string", format: "uri" } }, required: ["url"], additionalProperties: false } }, execute: async args => {
    executed.push(String(args.url));
    return { id: "external", source: "web", title: "Original method", url: String(args.url), content: "The original method uses code.", updatedAt: new Date().toISOString() };
  } }], pricing: { input: 2, output: 3 } });
  const result = await runtime.ask({ message: "Read this paper" });
  expect(executed).toEqual(["https://example.org/original"]);
  expect(result.citations).toEqual([expect.objectContaining({ documentId: "external", url: "https://example.org/original" })]);
  expect(result.messages?.filter(message => message.role === "tool").map(message => JSON.parse(message.content!))).toEqual([expect.objectContaining({ error: expect.any(String) }), expect.objectContaining({ id: "external" })]);
});
