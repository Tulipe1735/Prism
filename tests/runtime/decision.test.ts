import type { Snapshot } from "./types.ts";

import { describe, expect, it, vi } from "vitest";
import { choose, validateChoice } from "./decision.ts";

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    url: "https://example.com",
    title: "Example",
    w: 1120,
    h: 780,
    text: "Hello",
    scroll: { y: 0, height: 780 },
    actions: [],
    marker: ["marker"],
    page_key: [],
    guards: {},
    omitted_actions: 0,
    ...overrides,
  };
}

function mockJsonFetch(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

function requestBody(mock: ReturnType<typeof vi.fn>): any {
  return JSON.parse(String(mock.mock.calls[0]![1]!.body));
}

describe("validateChoice", () => {
  it("accepts a finite distribution whose maximum is the choice", () => {
    const result = validateChoice(
      { choice: "A", probabilities: { A: 0.7, B: 0.3 }, confidence: 0.7 },
      { A: {}, B: {} },
    );
    expect(result.choice).toBe("A");
  });

  it("rejects a choice that is not the argmax", () => {
    expect(() =>
      validateChoice(
        { choice: "A", probabilities: { A: 0.4, B: 0.6 }, confidence: 0.4 },
        { A: {}, B: {} },
      ),
    ).toThrow(/Invalid TypeSafe response/);
  });

  it("rejects distributions that do not sum to one", () => {
    expect(() =>
      validateChoice(
        { choice: "A", probabilities: { A: 0.4, B: 0.4 }, confidence: 0.4 },
        { A: {}, B: {} },
      ),
    ).toThrow(/Invalid TypeSafe response/);
  });

  it("rejects unknown or missing ids", () => {
    expect(() =>
      validateChoice(
        { choice: "C", probabilities: { A: 0.5, B: 0.5 }, confidence: 0.5 },
        { A: {}, B: {} },
      ),
    ).toThrow(/Invalid TypeSafe response/);
  });
});

describe("choose", () => {
  const clickAction = {
    id: "e1",
    kind: "click" as const,
    node: 1,
    role: "button",
    label: "Save",
  };

  it("resolves a target head into an observed action id", async () => {
    const fetchMock = mockJsonFetch({
      model: "jev-latest",
      usage: { total_tokens: 12 },
      answers: {
        operation: {
          choice: "CLICK",
          probabilities: { CLICK: 0.9, DONE: 0.05, BLOCKED: 0.05 },
          confidence: 0.9,
        },
        click_target: {
          choice: "1",
          probabilities: { "1": 1 },
          confidence: 0.95,
        },
      },
    });

    const decision = await choose({
      snapshot: snapshot({ actions: [clickAction] }),
      goal: "Click Save",
      history: [],
      apiKey: "test-key",
      fetchImpl: asFetch(fetchMock),
    });

    expect(decision.choice).toBe("e1");
    expect(decision.operation).toBe("CLICK");
    expect(decision.target).toBe("1");
    expect(decision.probabilities).toEqual({ e1: 1 });
    expect(decision.model).toBe("jev-latest");

    const body = requestBody(fetchMock);
    expect(body.questions.operation.criteria).toMatchObject({
      CLICK: expect.any(String),
      DONE: expect.any(String),
      BLOCKED: expect.any(String),
    });
    expect(body.state.elements).toHaveLength(1);
    expect(body.state.recent_actions).toEqual([]);
  });

  it("maps a control operation to its observed action", async () => {
    const fetchMock = mockJsonFetch({
      model: "jev-latest",
      usage: {},
      answers: {
        operation: {
          choice: "WAIT",
          probabilities: { WAIT: 0.8, DONE: 0.1, BLOCKED: 0.1 },
          confidence: 0.8,
        },
      },
    });

    const decision = await choose({
      snapshot: snapshot({
        actions: [{ id: "wait", kind: "wait", label: "Wait for the page to update" }],
      }),
      goal: "Wait for results",
      history: [],
      apiKey: "test-key",
      fetchImpl: asFetch(fetchMock),
    });

    expect(decision.choice).toBe("wait");
    expect(decision.operation).toBe("WAIT");
    expect(decision.target).toBeNull();
  });

  it("surfaces an invalid decision without executing anything", async () => {
    const fetchMock = mockJsonFetch({
      model: "jev-latest",
      usage: {},
      answers: {
        operation: {
          choice: "CLICK",
          probabilities: { CLICK: 0.5, DONE: 0.5, BLOCKED: 0.5 },
          confidence: 0.5,
        },
      },
    });

    await expect(
      choose({
        snapshot: snapshot({ actions: [clickAction] }),
        goal: "Click Save",
        history: [],
        apiKey: "test-key",
        fetchImpl: asFetch(fetchMock),
      }),
    ).rejects.toThrow(/Invalid TypeSafe response/);
  });
});
