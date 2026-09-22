import type { Snapshot } from "../../src/shared/types.ts";

import { describe, expect, it, vi } from "vitest";
import { fieldContext, fieldText } from "../../src/runtime/text-helper.ts";

function mockJsonFetch(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

function completion(content: string): unknown {
  return { choices: [{ message: { content } }], usage: { total_tokens: 5 } };
}

const page: Snapshot = {
  url: "https://example.com",
  title: "Contact",
  w: 1120,
  h: 780,
  text: "Email address",
  scroll: { y: 0, height: 780 },
  actions: [],
  marker: [],
  page_key: [],
  guards: {},
  omitted_actions: 0,
};

describe("fieldContext", () => {
  it("truncates page text and keeps the recent action tail", () => {
    const context = fieldContext(
      "Send an email",
      { id: "e1", kind: "fill", node: 1, label: "Email", role: "textbox", value: "" },
      { ...page, text: "x".repeat(7000) },
      [
        {
          step: 1,
          action: "Save",
          kind: "click",
          choice: "e9",
          probability: 1,
          confidence: 1,
          latency_ms: 1,
          text: null,
          text_helper: null,
          text_latency_ms: 0,
          operation: "CLICK",
          target: null,
          page_changed: true,
          url: page.url,
          usage: {},
          executed_ms: 1,
          elapsed_ms: 1,
        },
      ],
    );

    expect(context.field.label).toBe("Email");
    expect(context.page.text).toHaveLength(6000);
    expect(context.recent_actions).toEqual([{ action: "Save", text: null }]);
  });
});

describe("fieldText", () => {
  it("returns a generated field value", async () => {
    const fetchMock = mockJsonFetch(completion('{"text":"person@example.com"}'));
    const result = await fieldText(
      {
        goal: "Email me",
        field: { label: "Email" },
        page: { title: "", text: "" },
        recent_actions: [],
      },
      { apiKey: "key", fetchImpl: asFetch(fetchMock) },
    );

    expect(result.text).toBe("person@example.com");
    expect(result.model).toBe("deepseek-chat");
    expect(fetchMock).toHaveBeenCalledOnce();

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("sends the OpenCode Go session header and no reasoning field", async () => {
    const fetchMock = mockJsonFetch(completion('{"text":"x"}'));
    await fieldText(
      {
        goal: "Email me",
        field: { label: "Email" },
        page: { title: "", text: "" },
        recent_actions: [],
      },
      {
        apiKey: "key",
        baseUrl: "https://opencode.ai/zen/go/v1",
        model: "glm-5.3-flash",
        sessionId: "session-1",
        fetchImpl: asFetch(fetchMock),
      },
    );

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.headers["x-opencode-session"]).toBe("session-1");
    expect(init.headers["user-agent"]).toMatch(/^prism\//);
    expect(JSON.parse(String(init.body)).reasoning).toBeUndefined();
  });

  it("returns null when the goal does not contain the value", async () => {
    const fetchMock = mockJsonFetch(completion('{"text":null}'));
    const result = await fieldText(
      {
        goal: "Email me",
        field: { label: "Email" },
        page: { title: "", text: "" },
        recent_actions: [],
      },
      { apiKey: "key", fetchImpl: asFetch(fetchMock) },
    );
    expect(result.text).toBeNull();
  });

  it.each([
    ["malformed JSON", "not json"],
    ["extra keys", '{"text":"a","other":1}'],
    ["empty text", '{"text":"  "}'],
    ["non-string text", '{"text":5}'],
  ])("rejects %s", async (_name, content) => {
    const fetchMock = mockJsonFetch(completion(content));
    await expect(
      fieldText(
        {
          goal: "Email me",
          field: { label: "Email" },
          page: { title: "", text: "" },
          recent_actions: [],
        },
        { apiKey: "key", fetchImpl: asFetch(fetchMock) },
      ),
    ).rejects.toThrow(/no valid field value/);
  });
});
