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
  const alternativeEvidence = [
    { documentId: "seed", quote: "Template scenes reuse authored templates." },
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
          {
            ...method,
            name: "Template scenes",
            mechanism: "Reuse authored templates",
            evidence: alternativeEvidence,
          },
        ]
      : [method],
    claims: [
      {
        id: "claim-build",
        text: "Scene programs construct training environments.",
        evidence,
      },
      ...(twoMethods
        ? [
            {
              id: "claim-template",
              text: "Template scenes reuse authored templates.",
              evidence: alternativeEvidence,
            },
          ]
        : []),
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
    content:
      "Scene programs construct training environments. Template scenes reuse authored templates.",
    updatedAt: new Date().toISOString(),
  });
  const review = {
    checks: [
      {
        claimId: "claim-build",
        verdict: "supported",
        reason: "The quoted original source supports this statement.",
      },
      {
        claimId: "claim-template",
        verdict: "supported",
        reason: "The distinct quoted sentence explicitly describes template reuse.",
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
    {
      message: {
        role: "assistant",
        content: JSON.stringify({ ...review, checks: review.checks.slice(0, 1) }),
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
    {
      message: {
        role: "assistant",
        content: JSON.stringify({ ...review, checks: review.checks.slice(0, 1) }),
      },
    },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    maxRounds: 6,
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
    const messages = requests.at(-1)!.messages;
    for (let index = 0; index < messages.length; index++) {
      const calls = messages[index]!.tool_calls;
      if (
        calls?.some(
          (call) =>
            !messages
              .slice(index + 1)
              .some(
                (message) =>
                  message.role === "tool" && message.tool_call_id === call.id,
              ),
        )
      )
        return new Response("Missing tool result", { status: 400 });
    }
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

it("requires trusted confirmation of unchanged memory content and shares the confirmed progress with intelligence", async () => {
  const store = openStore();
  const call = (id: string, text: string, status: string): ModelMessage => ({
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: {
          name: "memory_update",
          arguments: JSON.stringify({ id: "focus", kind: "progress", text, status }),
        },
      },
    ],
  });
  const draft = apiFixture([
    { message: call("self-confirm", "Compare scene generators", "confirmed") },
    { message: call("save-draft", "Compare scene generators", "tentative") },
    {
      message: {
        role: "assistant",
        content: "Saved the proposed research progress for confirmation.",
      },
    },
  ]);
  await new AssistantRuntime({
    store,
    model: draft.model,
    pricing: { input: 2, output: 3 },
  }).ask({ message: "Our next question is to compare scene generators" });
  expect(store.listMemory()).toEqual([
    expect.objectContaining({
      id: "focus",
      text: "Compare scene generators",
      status: "tentative",
    }),
  ]);
  expect(
    draft.requests[1]?.messages
      .filter((message) => message.role === "tool")
      .map((message) => JSON.parse(message.content!)),
  ).toEqual([
    expect.objectContaining({
      error: expect.stringContaining("Explicit user confirmation"),
    }),
  ]);
  const confirm = apiFixture([
    {
      message: call(
        "change-content",
        "An unapproved different research direction",
        "confirmed",
      ),
    },
    { message: call("confirmed", "Compare scene generators", "confirmed") },
    {
      message: {
        role: "assistant",
        content: "The unchanged research progress is now confirmed.",
      },
    },
  ]);
  await new AssistantRuntime({
    store,
    model: confirm.model,
    pricing: { input: 2, output: 3 },
  }).ask({
    message: "Confirm the existing focus entry",
    confirmedMemoryIds: ["focus"],
  });
  expect(store.listMemory()).toEqual([
    expect.objectContaining({
      id: "focus",
      text: "Compare scene generators",
      status: "confirmed",
    }),
  ]);
  const briefing = apiFixture([
    { message: { role: "assistant", content: '{"items":[]}' } },
  ]);
  const result = await new AssistantRuntime({
    store,
    model: briefing.model,
    pricing: { input: 2, output: 3 },
  }).ask({ message: "Select the morning recommendations", role: "intelligence" });
  expect(result.answer).toBe('{"items":[]}');
  expect(JSON.stringify(briefing.requests[0]?.messages)).toContain(
    "Compare scene generators",
  );
  expect(JSON.stringify(briefing.requests[0]?.messages)).not.toContain(
    "An unapproved different research direction",
  );
});

it("restores scoped conversation context after restart without combining other roles or conversations", async () => {
  const store = openStore();
  const fixture = apiFixture([
    { message: { role: "assistant", content: "Scoped QA research answer." } },
    { message: { role: "assistant", content: "Unrelated course answer." } },
    { message: { role: "assistant", content: "Separate intelligence answer." } },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    pricing: { input: 2, output: 3 },
  });
  await runtime.ask({
    message: "Research question",
    conversationId: "research",
    role: "qa",
  });
  await runtime.ask({
    message: "Course question",
    conversationId: "courses",
    role: "qa",
  });
  await runtime.ask({
    message: "Morning brief",
    conversationId: "research",
    role: "intelligence",
  });
  store.close();
  const reopened = new AssistantStore(store.directory);
  stores.push(reopened);
  const continued = apiFixture([
    { message: { role: "assistant", content: "Continue the same research question." } },
  ]);
  const result = await new AssistantRuntime({
    store: reopened,
    model: continued.model,
    pricing: { input: 2, output: 3 },
  }).ask({ message: "Continue", conversationId: "research", role: "qa" });
  expect(result.status).toBe("completed");
  const context = JSON.stringify(continued.requests[0]?.messages);
  expect(context).toContain("Scoped QA research answer.");
  expect(context).not.toContain("Unrelated course answer.");
  expect(context).not.toContain("Separate intelligence answer.");
});

it("accounts for infrastructure before starting paid requests and charges unknown provider failures conservatively", async () => {
  const blockedStore = openStore(10.001);
  const blocked = apiFixture([]);
  const result = await new AssistantRuntime({
    store: blockedStore,
    model: blocked.model,
    pricing: { input: 2, output: 3 },
  }).ask({ message: "Research this question" });
  expect(result).toMatchObject({ status: "partial", costCny: 0 });
  expect(result.error).toContain("预算");
  expect(blocked.fetch).not.toHaveBeenCalled();
  const store = openStore();
  const model = new DeepSeekModel({
    apiKey: "private-key-fixture",
    model: "deepseek-flash",
    fetch: async () =>
      new Response("Server error echoed private-key-fixture", { status: 503 }),
  });
  const failure = await new AssistantRuntime({
    store,
    model,
    pricing: { input: 2, output: 3 },
  }).ask({ message: "Research this question" });
  expect(failure).toMatchObject({
    status: "failed",
    usage: { inputTokens: 0, outputTokens: 0 },
  });
  expect(failure.costCny).toBeGreaterThan(0);
  expect(store.budget()).toMatchObject({ reservedCny: 0, spentCny: failure.costCny });
  expect(failure.answer).toContain("HTTP 503");
  expect(JSON.stringify(failure)).not.toContain("private-key-fixture");
});

it("pauses a batch of tools without executing later side effects and resumes with a complete provider conversation", async () => {
  const store = openStore();
  let writes = 0;
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        reasoning_content: "Read local evidence before changing anything.",
        tool_calls: [
          {
            id: "portal",
            type: "function",
            function: { name: "local_prism", arguments: "{}" },
          },
          {
            id: "later-write",
            type: "function",
            function: { name: "later_write", arguments: "{}" },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "Local course evidence has been read; no later write was performed.",
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
          description: "Read local course evidence",
          parameters: { type: "object", properties: {} },
        },
        execute: async () => ({ status: "waiting-device", jobId: "local-job" }),
      },
      {
        definition: {
          name: "later_write",
          description: "Modify local data",
          parameters: { type: "object", properties: {} },
        },
        execute: async () => {
          writes++;
          return { written: true };
        },
      },
    ],
  });
  const paused = await runtime.ask({ message: "Read courses before any modification" });
  expect(paused.status).toBe("waiting-device");
  expect(writes).toBe(0);
  store.updateTask(paused.id, {
    status: "queued",
    messages: paused.messages!.map((message) =>
      message.tool_call_id === "portal"
        ? { ...message, content: '{"status":"completed","course":"Operating systems"}' }
        : message,
    ),
  });
  const result = await runtime.run(paused.id);
  expect(result.status).toBe("completed");
  expect(writes).toBe(0);
  expect(result.usage).toMatchObject({ inputTokens: 200, outputTokens: 100 });
  expect(result.messages).toContainEqual(
    expect.objectContaining({
      tool_call_id: "later-write",
      content: expect.stringContaining("not_executed"),
    }),
  );
});

it("includes device waiting in the original deep deadline and delivers the saved candidate without restarting paid work", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T02:00:00Z"));
  const store = openStore();
  store.upsertDocument({
    id: "seed",
    source: "arxiv",
    title: "Evidence",
    url: "https://example.org/paper",
    content:
      "Scene programs construct training environments. Template scenes reuse authored templates.",
    updatedAt: new Date().toISOString(),
  });
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "read",
            type: "function",
            function: { name: "document_read", arguments: '{"id":"seed"}' },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: JSON.stringify(candidate("The saved candidate comparison.")),
      },
    },
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "local-check",
            type: "function",
            function: { name: "local_prism", arguments: "{}" },
          },
        ],
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
          description: "Check local evidence",
          parameters: { type: "object", properties: {} },
        },
        execute: async () => ({ status: "waiting-device", jobId: "local-evidence" }),
      },
    ],
  });
  const paused = await runtime.ask({
    message: "Compare the approaches",
    effort: "deep",
  });
  expect(paused.status).toBe("waiting-device");
  vi.setSystemTime(new Date("2026-10-18T02:21:00Z"));
  store.updateTask(paused.id, {
    status: "queued",
    messages: paused.messages!.map((message) =>
      message.tool_call_id === "local-check"
        ? { ...message, content: '{"status":"completed"}' }
        : message,
    ),
  });
  const result = await runtime.run(paused.id);
  expect(result).toMatchObject({
    status: "partial",
    startedAt: paused.startedAt,
    deadlineAt: "2026-10-18T02:20:00.000Z",
    costCny: paused.costCny,
  });
  expect(fixture.requests).toHaveLength(3);
  expect(result.answer).toContain("The saved candidate comparison.");
  expect(result.answer).toContain("达到任务时间上限");
  expect(result.answer).not.toContain("任务状态：waiting-device");
});

it("keeps a truncated normal answer as an explicit partial outcome", async () => {
  const store = openStore();
  const model = new DeepSeekModel({
    apiKey: "fixture",
    model: "deepseek-flash",
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "This useful partial source-based answer was cut short.",
              },
              finish_reason: "length",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        }),
      ),
  });
  const result = await new AssistantRuntime({
    store,
    model,
    pricing: { input: 2, output: 3 },
  }).ask({ message: "Explain the source" });
  expect(result.status).toBe("partial");
  expect(result.answer).toContain(
    "This useful partial source-based answer was cut short.",
  );
  expect(result.error).toContain("length");
});

it("keeps withdrawn sources in the audit record but excludes their old answers and derived memory from new task context", async () => {
  const store = openStore();
  const at = new Date().toISOString();
  store.upsertDocument({
    id: "withdrawn",
    source: "notion",
    title: "Old source",
    url: "https://example.org/source",
    content: "Legacy evidence from the old source.",
    version: "one",
    updatedAt: at,
  });
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "read-old",
            type: "function",
            function: { name: "document_read", arguments: '{"id":"withdrawn"}' },
          },
        ],
      },
    },
    {
      message: {
        role: "assistant",
        content: "Legacy source conclusion. [Old source](https://example.org/source)",
      },
    },
    {
      message: {
        role: "assistant",
        content: "The old source is unavailable; new evidence is needed.",
      },
    },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    pricing: { input: 2, output: 3 },
  });
  const old = await runtime.ask({
    message: "Read the legacy source",
    conversationId: "research",
  });
  store.upsertMemory({
    id: "derived",
    kind: "progress",
    text: "Legacy derived progress should be rechecked.",
    status: "confirmed",
    sourceDocumentIds: ["withdrawn"],
    createdAt: at,
    updatedAt: at,
  });
  store.removeDocument("withdrawn");
  await runtime.ask({
    message: "Continue the legacy research",
    conversationId: "research",
  });
  const context = JSON.stringify(fixture.requests[2]?.messages);
  expect(context).not.toContain("Legacy source conclusion.");
  expect(context).not.toContain("Legacy derived progress should be rechecked.");
  expect(store.getTask(old.id)?.answer).toContain("Legacy source conclusion.");
  expect(store.listMemory()).toContainEqual(
    expect.objectContaining({ id: "derived", status: "tentative" }),
  );
});

it("does not reuse an old answer after its cited source version changes", async () => {
  const store = openStore();
  const document = {
    id: "versioned",
    source: "notion" as const,
    title: "Versioned source",
    url: "https://example.org/versioned",
    content: "Original evidence is unchanged, but the source version advances.",
    version: "one",
    updatedAt: new Date().toISOString(),
  };
  store.upsertDocument(document);
  const fixture = apiFixture([
    {
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "read-version",
            type: "function",
            function: { name: "document_read", arguments: '{"id":"versioned"}' },
          },
        ],
      },
    },
    { message: { role: "assistant", content: "The superseded version's conclusion." } },
    {
      message: {
        role: "assistant",
        content: "Recheck the current source before concluding.",
      },
    },
  ]);
  const runtime = new AssistantRuntime({
    store,
    model: fixture.model,
    pricing: { input: 2, output: 3 },
  });
  await runtime.ask({
    message: "Read the original version",
    conversationId: "versions",
  });
  store.upsertDocument({ ...document, version: "two" });
  await runtime.ask({ message: "Continue the comparison", conversationId: "versions" });
  expect(JSON.stringify(fixture.requests[2]?.messages)).not.toContain(
    "The superseded version's conclusion.",
  );
});
