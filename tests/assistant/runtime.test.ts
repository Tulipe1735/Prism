import type { ModelMessage } from "../../src/assistant/types.ts";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { DeepSeekModel } from "../../src/assistant/deepseek.ts";
import { AssistantRuntime } from "../../src/assistant/runtime.ts";
import { AssistantStore } from "../../src/assistant/store.ts";

const directories: string[] = [];
const stores: AssistantStore[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function candidate(report: string, twoMethods = true) {
  const evidence = [
    { documentId: "seed", quote: "Scene programs construct training environments." },
  ];
  const method = {
    name: "Scene programs",
    mechanism: "Construct scenes with code",
    assumptions: "Simulation supports program execution",
    experiments: "A fixed task set",
    conditions: "Task sets differ, so scores are not directly comparable",
    costs: "Training cost is not reported",
    limitations: "Simulation transfer is uncertain",
    evidence,
  };
  return {
    report,
    problem: "Generate training environments",
    methods: twoMethods
      ? [
          method,
          { ...method, name: "Template scenes", mechanism: "Reuse authored templates" },
        ]
      : [method],
    claims: [
      {
        id: "claim-build",
        text: "Scene programs construct training environments.",
        evidence,
      },
    ],
    comparisonConditions: "Different evaluation tasks prevent ranking raw scores.",
    nextSteps: ["Compare both methods on the same task set."],
    gaps: ["Compute cost is not reported."],
  };
}

it("checks and revises deep research, retaining the better grounded comparison when a longer revision loses method coverage", async () => {
  const store = openStore();
  store.upsertDocument({
    id: "seed",
    source: "arxiv",
    title: "Evidence",
    url: "https://example.org/paper",
    content: "Scene programs construct training environments.",
    updatedAt: new Date().toISOString(),
  });
  const review = {
    checks: [
      {
        claimId: "claim-build",
        verdict: "supported",
        reason: "The quoted original source supports this statement.",
      },
    ],
    issues: ["Resource cost needs more evidence."],
    complete: false,
  };
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "evidence",
            type: "function",
            function: { name: "document_read", arguments: '{"id":"seed"}' },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: JSON.stringify(
          candidate("The original comparison retains both methods."),
        ),
      },
    },
    { message: { role: "assistant", content: JSON.stringify(review) } },
    {
      message: {
        role: "assistant",
        content: JSON.stringify(
          candidate(
            `A much longer but narrower revision. ${"Extra prose. ".repeat(150)}`,
            false,
          ),
        ),
      },
    },
    { message: { role: "assistant", content: JSON.stringify(review) } },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    maxRounds: 5,
    pricing: { input: 2, output: 3 },
  });
  const result = await runtime.ask({
    message: "Compare approaches to generating training environments",
    effort: "deep",
  });
  expect(result.answer).toContain("The original comparison retains both methods.");
  expect(result.answer).not.toContain("A much longer but narrower revision");
  expect(result.status).toBe("partial");
  expect(result.events.map((event) => event.kind)).toEqual(
    expect.arrayContaining([
      "research-solve",
      "research-check",
      "research-revise",
      "candidate-retained",
    ]),
  );
});

function openStore(budgetCny = 50) {
  const directory = mkdtempSync(join(tmpdir(), "prism-runtime-"));
  directories.push(directory);
  const store = new AssistantStore(directory, { budgetCny, infrastructureCny: 10 });
  stores.push(store);
  return store;
}

function apiFixture(
  replies: Array<{
    message: ModelMessage;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      prompt_cache_hit_tokens?: number;
    };
  }>,
) {
  const requests: Array<{
    messages: ModelMessage[];
    model: string;
    max_tokens: number;
    tools: unknown[];
  }> = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)));
    const reply = replies.shift();
    if (!reply) throw new Error("Unexpected paid provider request in fixture");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: reply.message,
            finish_reason: reply.message.tool_calls?.length ? "tool_calls" : "stop",
          },
        ],
        usage: reply.usage ?? {
          prompt_tokens: 100,
          completion_tokens: 50,
          prompt_cache_hit_tokens: 20,
        },
      }),
    );
  });
  return {
    model: new DeepSeekModel({
      apiKey: "fixture-only",
      model: "deepseek-flash",
      fetch,
    }),
    requests,
    fetch,
  };
}

it("answers from source material, preserves tool reasoning, and records usage and a readable report", async () => {
  const store = openStore();
  store.upsertDocument({
    id: "seed",
    source: "arxiv",
    title: "Verified paper",
    url: "https://arxiv.org/abs/2605.09423",
    content:
      "Scene programs construct training environments. Evaluation uses a fixed set of tasks.",
    updatedAt: new Date().toISOString(),
  });
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        reasoning_content: "Retrieve the relevant evidence.",
        tool_calls: [
          {
            id: "call-source",
            type: "function",
            function: {
              name: "library_search",
              arguments: '{"query":"training environments"}',
            },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content:
          "Scene programs construct training environments. [Verified paper](https://arxiv.org/abs/2605.09423)",
      },
    },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    pricing: { input: 2, output: 3, cacheHit: 0.2 },
  });
  const result = await runtime.ask({
    message: "What does the paper build?",
    conversationId: "research",
  });
  expect(result.status).toBe("completed");
  expect(result.citations).toEqual([
    expect.objectContaining({
      documentId: "seed",
      excerpt: expect.stringContaining("training environments"),
    }),
  ]);
  expect(result.usage).toEqual({
    inputTokens: 200,
    outputTokens: 100,
    cacheHitTokens: 40,
  });
  expect(result.costCny).toBeCloseTo(0.000628, 6);
  expect(store.budget()).toMatchObject({ reservedCny: 0, spentCny: result.costCny });
  expect(readFileSync(result.artifacts![0]!, "utf8")).toContain("Scene programs");
  expect(fixture.requests[1]?.messages).toContainEqual(
    expect.objectContaining({
      reasoning_content: "Retrieve the relevant evidence.",
      tool_calls: [expect.objectContaining({ id: "call-source" })],
    }),
  );
});

it("rejects invalid external tool arguments and retains citations from a valid source read", async () => {
  const store = openStore();
  const executed: string[] = [];
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "invalid",
            type: "function",
            function: { name: "paper_read", arguments: '{"url":17}' },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "valid",
            type: "function",
            function: {
              name: "paper_read",
              arguments: '{"url":"https://example.org/original"}',
            },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content:
          "The original method uses code. [Source](https://example.org/original)",
      },
    },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    tools: [
      {
        definition: {
          name: "paper_read",
          description: "Read a paper",
          parameters: {
            type: "object",
            properties: { url: { type: "string", format: "uri" } },
            required: ["url"],
            additionalProperties: false,
          },
        },
        execute: async (args) => {
          executed.push(String(args.url));
          return {
            id: "external",
            source: "web",
            title: "Original method",
            url: String(args.url),
            content: "The original method uses code.",
            updatedAt: new Date().toISOString(),
          };
        },
      },
    ],
    pricing: { input: 2, output: 3 },
  });
  const result = await runtime.ask({ message: "Read this paper" });
  expect(executed).toEqual(["https://example.org/original"]);
  expect(result.citations).toEqual([
    expect.objectContaining({
      documentId: "external",
      url: "https://example.org/original",
    }),
  ]);
  expect(
    result.messages
      ?.filter((message) => message.role === "tool")
      .map((message) => JSON.parse(message.content!)),
  ).toEqual([
    expect.objectContaining({ error: expect.any(String) }),
    expect.objectContaining({ id: "external" }),
  ]);
});

it("reading a source chunk preserves the full imported source for later tasks", async () => {
  const store = openStore();
  const content = "Earlier evidence. Later evidence remains available.";
  store.upsertDocument({
    id: "whole",
    source: "file",
    title: "Whole source",
    url: "file:///notes.md",
    content,
    updatedAt: new Date().toISOString(),
  });
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "chunk",
            type: "function",
            function: {
              name: "document_read",
              arguments: '{"id":"whole","offset":18,"limit":14}',
            },
          },
        ],
      },
    },
    { message: { role: "assistant", content: "Read the later evidence." } },
  ]);
  const result = await new AssistantRuntime({
    store,
    model: fixture.model,
    pricing: { input: 2, output: 3 },
  }).ask({ message: "Read the later evidence" });
  expect(result.status).toBe("completed");
  expect(store.getDocument("whole")?.content).toBe(content);
  expect(result.citations).toEqual([
    expect.objectContaining({ excerpt: "Later evidence", locator: "characters 19–32" }),
  ]);
});

it("aborts a pending paid request at the twenty-minute deep deadline and settles unknown usage conservatively", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T01:00:00Z"));
  const store = openStore();
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signals.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const runtime = new AssistantRuntime({
    store,
    model: new DeepSeekModel({ apiKey: "fixture", model: "deepseek-flash", fetch }),
    deepTimeoutMs: 2_000_000,
    pricing: { input: 2, output: 3 },
  });
  const pending = runtime.ask({ message: "Compare the methods", effort: "deep" });
  await vi.advanceTimersByTimeAsync(1_200_000);
  const result = await pending;
  expect(result).toMatchObject({
    status: "partial",
    deadlineAt: "2026-10-18T01:20:00.000Z",
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  expect(signals).toHaveLength(1);
  expect(signals[0]!.aborted).toBe(true);
  expect(result.answer).toContain("达到任务时间上限");
  expect(result.costCny).toBeGreaterThan(0);
  expect(store.budget()).toMatchObject({ spentCny: result.costCny, reservedCny: 0 });
  expect(result.events).toContainEqual(
    expect.objectContaining({ kind: "cost-estimate" }),
  );
});

it("cancels a running tool and stops subsequent model work while preserving completed usage", async () => {
  const store = openStore();
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "slow",
            type: "function",
            function: { name: "slow_source", arguments: "{}" },
          },
        ],
      },
    },
  ]);
  let toolReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    toolReady = resolve;
  });
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    pricing: { input: 2, output: 3 },
    tools: [
      {
        definition: {
          name: "slow_source",
          description: "Read a slow source",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
        execute: async (_args, context) =>
          new Promise((_resolve, reject) => {
            toolReady();
            context.signal.addEventListener(
              "abort",
              () => reject(context.signal.reason),
              { once: true },
            );
          }),
      },
    ],
  });
  const task = runtime.submit({ message: "Read the slow source" });
  const pending = runtime.run(task.id);
  await ready;
  expect(runtime.get(task.id)?.events).toContainEqual(
    expect.objectContaining({ kind: "tool-started" }),
  );
  expect(runtime.cancel(task.id).status).toBe("cancelled");
  const result = await pending;
  expect(result).toMatchObject({
    status: "cancelled",
    usage: { inputTokens: 100, outputTokens: 50 },
  });
  expect(fixture.requests).toHaveLength(1);
  expect(store.budget()).toMatchObject({ spentCny: result.costCny, reservedCny: 0 });
});

it("shares confirmed research progress across roles and refreshes withdrawn rules when a paused task resumes", async () => {
  const store = openStore();
  const at = new Date().toISOString();
  store.upsertMemory({
    id: "research-focus",
    kind: "progress",
    status: "confirmed",
    text: "Current focus: compare reusable scene generators with the RSI survey.",
    createdAt: at,
    updatedAt: at,
  });
  store.upsertMemory({
    id: "old-correction",
    kind: "correction",
    status: "confirmed",
    text: "Retired rule: always discuss obsolete baselines.",
    createdAt: at,
    updatedAt: at,
  });
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "device",
            type: "function",
            function: { name: "local_prism", arguments: "{}" },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "The confirmed research focus guides this recommendation.",
      },
    },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    pricing: { input: 2, output: 3 },
    tools: [
      {
        definition: {
          name: "local_prism",
          description: "Read local material",
          parameters: { type: "object", properties: {} },
        },
        execute: async () => ({ status: "waiting-device", jobId: "job-1" }),
      },
    ],
  });
  const paused = await runtime.ask({
    message: "Prepare relevant research recommendations",
    role: "intelligence",
    conversationId: "brief",
  });
  expect(paused.status).toBe("waiting-device");
  expect(JSON.stringify(fixture.requests[0]?.messages)).toContain(
    "Current focus: compare reusable scene generators",
  );
  store.deleteMemory("old-correction");
  const messages = paused.messages!.map((message) =>
    message.tool_call_id === "device"
      ? { ...message, content: '{"status":"completed","evidence":"local source read"}' }
      : message,
  );
  store.updateTask(paused.id, { status: "queued", messages });
  const result = await runtime.run(paused.id);
  expect(result.status).toBe("completed");
  expect(JSON.stringify(fixture.requests[1]?.messages)).toContain(
    "Current focus: compare reusable scene generators",
  );
  expect(JSON.stringify(fixture.requests[1]?.messages)).not.toContain(
    "Retired rule: always discuss obsolete baselines.",
  );
});
