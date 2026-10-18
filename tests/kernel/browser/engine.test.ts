import type { BrowserEngine } from "../../../src/kernel/types.ts";
import { describe, expect, it } from "vitest";

describe("browser engine selection", () => {
  it("rejects an unknown engine before doing anything else", async () => {
    const { openEngine } = await import("../../../src/kernel/browser/engine.ts");
    await expect(
      openEngine({ engine: "netscape" as BrowserEngine }),
    ).rejects.toMatchObject({ name: "ConfigError" });
  });

  it("refuses CDP takeover for Firefox and WebKit", async () => {
    const { openEngine } = await import("../../../src/kernel/browser/engine.ts");
    await expect(
      openEngine({ engine: "firefox", endpoint: "http://127.0.0.1:9" }),
    ).rejects.toMatchObject({
      name: "ConfigError",
      message: expect.stringContaining("Chromium"),
    });
    await expect(
      openEngine({ engine: "webkit", endpoint: "http://127.0.0.1:9" }),
    ).rejects.toMatchObject({ name: "ConfigError" });
  });

  it("reports how to start a browser when the takeover endpoint is unreachable", async () => {
    const { openEngine } = await import("../../../src/kernel/browser/engine.ts");
    await expect(openEngine({ endpoint: "http://127.0.0.1:9" })).rejects.toMatchObject({
      name: "ConfigError",
      message: expect.stringContaining("--remote-debugging-port"),
    });
  });
});
