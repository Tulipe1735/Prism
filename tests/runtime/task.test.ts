import { afterEach, describe, expect, it, vi } from "vitest";

import { runBrowserTask } from "../../src/runtime/task.ts";
import { ConfigError } from "../../src/shared/errors.ts";

describe("runBrowserTask configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires a TypeSafe key before touching the browser", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    await expect(
      runBrowserTask({ url: "https://example.com", goal: "do it" }),
    ).rejects.toThrow(ConfigError);
  });

  it("rejects a malformed browser endpoint before connecting", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    await expect(
      runBrowserTask({
        url: "https://example.com",
        goal: "do it",
        browserUrl: "not a url",
      }),
    ).rejects.toThrow(/Invalid --browser-url/);
  });
});
