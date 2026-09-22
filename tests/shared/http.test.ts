import { describe, expect, it, vi } from "vitest";

import { postJson } from "./http.ts";

function response(status: number, body: string): Response {
  return new Response(body, { status });
}

describe("postJson", () => {
  it("returns parsed JSON on success", async () => {
    const fetchImpl = vi.fn(async () => response(200, '{"ok":true}'));
    const result = await postJson({
      url: "https://example.com",
      apiKey: "key",
      body: { a: 1 },
      label: "Test model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries a rate-limited request once the provider recovers", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response(429, "slow down"))
      .mockResolvedValueOnce(response(200, '{"ok":true}'))
      .mockResolvedValue(response(200, '{"ok":true}'));

    const result = await postJson({
      url: "https://example.com",
      apiKey: "key",
      body: {},
      label: "Test model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails without executing anything on a hard HTTP error", async () => {
    const fetchImpl = vi.fn(async () => response(400, "bad request"));
    await expect(
      postJson({
        url: "https://example.com",
        apiKey: "key",
        body: {},
        label: "Test model",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 400; no action executed/);
  });

  it("rejects a malformed JSON body", async () => {
    const fetchImpl = vi.fn(async () => response(200, "not json"));
    await expect(
      postJson({
        url: "https://example.com",
        apiKey: "key",
        body: {},
        label: "Test model",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/invalid JSON/);
  });
});
