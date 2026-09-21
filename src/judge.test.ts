import type { Snapshot } from "./types.ts";

import { describe, expect, it, vi } from "vitest";
import { judgeOutcome } from "./judge.ts";

function mockJsonFetch(body: unknown): ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch;
}

const snapshot: Snapshot = {
  url: "https://example.com/done",
  title: "Done",
  w: 1120,
  h: 780,
  text: "Your message was sent",
  scroll: { y: 0, height: 780 },
  actions: [],
  marker: [],
  page_key: [],
  guards: {},
  omitted_actions: 0,
};

describe("judgeOutcome", () => {
  it("returns a parsed verdict with the judge model", async () => {
    const fetchMock = mockJsonFetch({
      choices: [
        {
          message: {
            content: '{"satisfied":true,"reason":"The page confirms the send."}',
          },
        },
      ],
    });

    const verdict = await judgeOutcome({
      goal: "Send the message",
      snapshot,
      history: [],
      apiKey: "key",
      model: "judge-model",
      fetchImpl: asFetch(fetchMock),
    });

    expect(verdict).toEqual({
      satisfied: true,
      reason: "The page confirms the send.",
      model: "judge-model",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.messages[0].content).toMatch(/untrusted data/);
    expect(JSON.parse(body.messages[1].content).goal).toBe("Send the message");
  });

  it("attaches the final screenshot when vision is enabled", async () => {
    const fetchMock = mockJsonFetch({
      choices: [
        { message: { content: '{"satisfied":false,"reason":"Not visible."}' } },
      ],
    });

    await judgeOutcome({
      goal: "See the flight",
      snapshot,
      history: [],
      apiKey: "key",
      vision: true,
      screenshotBase64: "abc123",
      fetchImpl: asFetch(fetchMock),
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    const content = body.messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[1].image_url.url).toBe("data:image/jpeg;base64,abc123");
  });

  it("rejects a malformed verdict", async () => {
    const fetchMock = mockJsonFetch({
      choices: [{ message: { content: '{"satisfied":"yes","reason":3}' } }],
    });

    await expect(
      judgeOutcome({
        goal: "Send the message",
        snapshot,
        history: [],
        apiKey: "key",
        fetchImpl: asFetch(fetchMock),
      }),
    ).rejects.toThrow(/no valid verdict/);
  });
});
