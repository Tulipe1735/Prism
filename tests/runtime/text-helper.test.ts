import type { Snapshot } from "../../src/shared/types.ts";

import { describe, expect, it, vi } from "vitest";
import {
  fieldContext,
  fieldText,
  samplingText,
  type TextContext,
} from "../../src/runtime/text-helper.ts";

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

describe("samplingText", () => {
  const context: TextContext = {
    goal: "Email me",
    field: { label: "Email" },
    page: { title: "", text: "" },
    recent_actions: [],
  };

  it("asks the connected host model for the field value", async () => {
    const createMessage = vi.fn(async () => ({
      content: { type: "text", text: '{"text":"person@example.com"}' },
      model: "host-model",
    }));

    const result = await samplingText(context, createMessage);

    expect(result.text).toBe("person@example.com");
    expect(result.model).toBe("host-model");
    expect(result.usage).toEqual({});
    expect(createMessage).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining("exactly one key"),
      messages: [
        { role: "user", content: { type: "text", text: JSON.stringify(context) } },
      ],
      maxTokens: 1024,
    });
  });

  it("reads the first text block from a content array", async () => {
    const createMessage = async () => ({
      content: [
        { type: "image", data: "aGk=", mimeType: "image/png" },
        { type: "text", text: '{"text":"Ada"}' },
      ],
      model: "host-model",
    });

    expect((await samplingText(context, createMessage)).text).toBe("Ada");
  });

  it("returns null when the host has no value", async () => {
    const createMessage = async () => ({
      content: { type: "text", text: '{"text":null}' },
      model: "host-model",
    });

    expect((await samplingText(context, createMessage)).text).toBeNull();
  });

  it("names the host when the model is missing", async () => {
    const createMessage = async () => ({
      content: { type: "text", text: '{"text":"Ada"}' },
    });

    expect((await samplingText(context, createMessage)).model).toBe("host model");
  });

  it.each([
    ["malformed JSON", { type: "text", text: "not json" }],
    ["extra keys", { type: "text", text: '{"text":"a","other":1}' }],
    ["empty text", { type: "text", text: '{"text":"  "}' }],
    ["no text block", { type: "image", data: "aGk=", mimeType: "image/png" }],
  ])("rejects %s", async (_name, content) => {
    const createMessage = async () => ({ content, model: "host-model" });
    await expect(samplingText(context, createMessage)).rejects.toThrow(
      /no valid field value/,
    );
  });
});
