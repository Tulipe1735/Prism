import type { ChooseInput } from "../../src/runtime/agent.ts";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pairKey, resultWriter, schedule } from "../../evals/runners/cohort.ts";
import { Collector } from "../../evals/runners/collector.ts";
import {
  chatDecision,
  modelInput,
  resolveSelector,
  SYSTEM_PROMPT,
} from "../../evals/runners/model.ts";
import { clusterInterval, wilson } from "../../evals/runners/statistics.ts";
import { cohortSchema, parseTasks } from "../../evals/schema.ts";
import { BrowserSession } from "../../src/browser/session.ts";

const cohort = cohortSchema.parse(
  JSON.parse(await readFile("evals/cohorts/pilot.json", "utf8")),
);
const input: ChooseInput = {
  goal: "Save draft",
  history: [],
  snapshot: {
    url: "http://local/",
    title: "Test",
    w: 1120,
    h: 780,
    text: "Save draft",
    scroll: { y: 0, height: 780 },
    actions: [
      { id: "e1", kind: "click", node: 1, label: "Save draft", role: "button" },
      { id: "wait", kind: "wait", label: "Wait" },
    ],
    marker: [],
    page_key: [],
    guards: {},
    omitted_actions: 0,
    fingerprint: "test",
  },
};
const identity = {
  schema_version: 3 as const,
  experiment_id: randomUUID(),
  task_id: "test",
  run_id: randomUUID(),
  variant: "prism-full" as const,
  provider: "model" as const,
  category: "grounding" as const,
  repetition: 0,
};
const heads = {
  operation: {
    choice: "CLICK",
    probabilities: { CLICK: 1, WAIT: 0, DONE: 0, BLOCKED: 0 },
    confidence: 0.9,
  },
  target: { choice: "1", probabilities: { "1": 1 }, confidence: 0.8 },
  text: null,
};
const session = new BrowserSession(
  {
    send: async () => ({
      result: {
        value: { dom: "<body><button>Save draft</button></body>", truncated: false },
      },
    }),
  },
  "target",
  "session",
);

it("uses fixed model/settings and identical system prompt across selector/indexed validation treatments", async () => {
  for (const [selector, validation] of [
    [false, true],
    [false, false],
    [true, true],
  ] as const) {
    const collector = new Collector(identity, null);
    collector.begin(1);
    const output = selector
      ? {
          ...heads,
          target: { choice: "button", probabilities: { button: 1 }, confidence: 0.8 },
        }
      : heads;
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            model: cohort.model,
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
            choices: [{ message: { content: JSON.stringify(output) } }],
          }),
        ),
    );
    const selectorSession = new BrowserSession(
      {
        send: vi
          .fn()
          .mockResolvedValueOnce({
            result: {
              value: {
                dom: "<body><button>Save draft</button></body>",
                truncated: false,
              },
            },
          })
          .mockResolvedValue({ result: { value: { node: 1 } } }),
      },
      "target",
      "session",
    );
    const result = await chatDecision({
      input,
      session: selector ? selectorSession : session,
      cohort,
      apiKey: "test",
      collector,
      signal: new AbortController().signal,
      selector,
      validation,
      fetchImpl,
    });
    expect(result.decision.choice).toBe("e1");
    const request = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: cohort.model,
      temperature: 0,
      top_p: 1,
      max_tokens: 8192,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user" }],
    });
    expect(request).not.toHaveProperty("reasoning_effort");
    expect(JSON.parse(request.messages[1].content)).not.toHaveProperty(
      "representation",
    );
    collector.finish();
    expect(collector.rows[0]).toMatchObject({
      llm_calls: 1,
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
      models: [cohort.model],
    });
  }
});
it("records actual HTTP retries and audits malformed distributions even with validation disabled", async () => {
  for (const validation of [true, false]) {
    const collector = new Collector(identity, null);
    collector.begin(1);
    const output = {
      ...heads,
      operation: {
        ...heads.operation,
        probabilities: { CLICK: 1, DONE: 0, BLOCKED: 0 },
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            model: cohort.model,
            choices: [{ message: { content: JSON.stringify(output) } }],
          }),
        ),
      );
    const work = chatDecision({
      input,
      session,
      cohort,
      apiKey: "test",
      collector,
      signal: new AbortController().signal,
      selector: false,
      validation,
      fetchImpl,
    });
    if (validation) await expect(work).rejects.toThrow(/Invalid TypeSafe response/);
    else expect((await work).decision.choice).toBe("e1");
    collector.finish();
    expect(collector.rows[0]).toMatchObject({
      llm_calls: 2,
      http_retries: 1,
      validation_valid: false,
    });
  }
});
it("does not leak action indices into selector target choices", () => {
  const indexed = modelInput(input, false, null);
  const raw = modelInput(input, true, null);
  expect(indexed.page).toEqual(raw.page);
  expect(indexed.operations).toEqual(raw.operations);
  expect(Object.keys(raw.targets.CLICK!)).toEqual(["candidate-1"]);
  expect(raw.targets.CLICK!["candidate-1"]).toContain("Save draft");
  expect(indexed.targets.CLICK!["1"]).toContain("Save draft");
});

it("classifies malformed operation heads without crashing the metrics collector", async () => {
  for (const output of [
    null,
    { operation: "CLICK", target: heads.target },
    { operation: { choice: "__proto__" } },
  ]) {
    const collector = new Collector(identity, null);
    collector.begin(1);
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            model: cohort.model,
            choices: [{ message: { content: JSON.stringify(output) } }],
          }),
        ),
    );
    await expect(
      chatDecision({
        input,
        session,
        cohort,
        apiKey: "test",
        collector,
        signal: new AbortController().signal,
        selector: false,
        validation: true,
        fetchImpl,
      }),
    ).rejects.toThrow(/Invalid TypeSafe response/);
    collector.finish();
    expect(collector.rows[0]?.validation_valid).toBe(false);
  }
});
describe("selector resolution", () => {
  it("refuses syntax, no-match, multiple and ineligible matches", async () => {
    for (const failure of ["syntax", "no-match", "multiple-match", "ineligible"]) {
      const browser = new BrowserSession(
        { send: vi.fn().mockResolvedValue({ result: { value: { failure } } }) },
        "target",
        "session",
      );
      await expect(
        resolveSelector(browser, input.snapshot, "button", "CLICK", null),
      ).rejects.toThrow(failure);
    }
    const browser = new BrowserSession(
      { send: vi.fn().mockResolvedValue({ result: { value: { node: 999 } } }) },
      "target",
      "session",
    );
    await expect(
      resolveSelector(browser, input.snapshot, "button", "CLICK", null),
    ).rejects.toThrow("ineligible");
  });
});
it("creates a balanced unique 288-pair schedule and serializes JSONL batches", async () => {
  const tasks = parseTasks(
    JSON.parse(await readFile("evals/tasks/primary.json", "utf8")),
  );
  expect(tasks).toHaveLength(24);
  const plan = schedule(tasks, cohort);
  expect(plan).toHaveLength(288);
  expect(new Set(plan.map((p) => pairKey({ ...p, task_id: p.task.id }))).size).toBe(
    288,
  );
  const directory = await mkdtemp(join(tmpdir(), "prism-writer-"));
  try {
    const path = join(directory, "out");
    const writer = resultWriter(path);
    await Promise.all([writer("a\nb\n"), writer("c\nd\n")]);
    expect(await readFile(path, "utf8")).toBe("a\nb\nc\nd\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("bounds Wilson intervals and reproduces task-cluster intervals", () => {
  expect(wilson(0, 3)[0]).toBe(0);
  expect(wilson(3, 3)[1]).toBe(1);
  expect(clusterInterval([1, 1, 1])).toEqual([1, 1]);
  expect(clusterInterval([0, 1, 0.5])).toEqual(clusterInterval([0, 1, 0.5]));
});

it("persists adaptive diagnostics without sending them to the model", async () => {
  const adaptiveCohort = cohortSchema.parse(
    JSON.parse(await readFile("evals/cohorts/ambiguity-adaptive-v1.json", "utf8")),
  );
  const collector = new Collector({ ...identity, variant: "indexed-adaptive" }, null);
  collector.begin(1);
  const browser = new BrowserSession(
    { send: async () => ({ result: { value: { contexts: {}, status: "Pending" } } }) },
    "target",
    "session",
  );
  const fetchImpl = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          model: adaptiveCohort.model,
          choices: [{ message: { content: JSON.stringify(heads) } }],
        }),
      ),
  );
  await chatDecision({
    input,
    session: browser,
    cohort: adaptiveCohort,
    apiKey: "test",
    collector,
    signal: new AbortController().signal,
    selector: false,
    validation: true,
    representation: "adaptive",
    fetchImpl,
  });
  const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
  const sent = JSON.parse(body.messages[1].content);
  expect(sent).not.toHaveProperty("adaptive");
  expect(sent).not.toHaveProperty("representation");
  expect(sent.targets.CLICK["1"]).toBe("[1] Save draft");
  collector.finish();
  expect(collector.rows[0]!.adaptive).toMatchObject({
    final_level: "compact",
    number_of_candidates: 1,
  });
  expect(collector.rows[0]!.adaptive!.estimated_representation_tokens).toBe(
    collector.rows[0]!.representation_cost!.estimated_tokens,
  );
});
