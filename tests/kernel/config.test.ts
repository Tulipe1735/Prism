import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configPath, loadConfig, resolveDataDir } from "../../src/kernel/config.ts";

describe("kernel config", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "prism-config-"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("defaults to DeepSeek, Chromium and a data directory under the home directory", async () => {
    vi.stubEnv("HOME", "/home/demo");

    expect(resolveDataDir()).toBe(join("/home/demo", ".prism"));
    expect(await loadConfig({ dataDir: "/data/prism" })).toEqual({
      dataDir: "/data/prism",
      model: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      browser: { engine: "chromium", actionsNeedApproval: false },
      search: { provider: "deepseek" },
      command: { timeoutMs: 120_000 },
      permissions: { scope: "workspace-write" },
    });
  });

  it("lets the config file override defaults, and explicit overrides win", async () => {
    await writeFile(
      configPath(dataDir),
      JSON.stringify({
        model: { apiKey: "sk-from-file", model: "deepseek-reasoner" },
        browser: { engine: "firefox", actionsNeedApproval: true },
        search: { provider: "brave", apiKey: "search-from-file" },
        command: { timeoutMs: 5_000 },
        permissions: { scope: "read-only" },
      }),
    );

    expect(
      await loadConfig({
        dataDir,
        overrides: { model: { apiKey: "sk-explicit", model: "deepseek-chat" } },
      }),
    ).toEqual({
      dataDir,
      model: {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-explicit",
      },
      browser: { engine: "firefox", actionsNeedApproval: true },
      search: { provider: "brave", apiKey: "search-from-file" },
      command: { timeoutMs: 5_000 },
      permissions: { scope: "read-only" },
    });
  });

  it("reads the PRISM_DATA_DIR environment variable when no data directory is passed", async () => {
    const override = join(dataDir, "elsewhere");
    vi.stubEnv("PRISM_DATA_DIR", override);

    expect(resolveDataDir()).toBe(override);
    expect((await loadConfig()).dataDir).toBe(override);
  });

  it("rejects invalid config files with the path of the file", async () => {
    await writeFile(
      configPath(dataDir),
      JSON.stringify({ browser: { engine: "safari" } }),
    );
    await expect(loadConfig({ dataDir })).rejects.toThrow(/config\.json/);

    await writeFile(
      configPath(dataDir),
      JSON.stringify({ search: { provider: "brave" }, extra: 1 }),
    );
    await expect(loadConfig({ dataDir })).rejects.toThrow(/config\.json/);

    await writeFile(
      configPath(dataDir),
      JSON.stringify({ command: { timeoutMs: -1 } }),
    );
    await expect(loadConfig({ dataDir })).rejects.toThrow(/config\.json/);
  });
});
