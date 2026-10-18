import type { ToolContext } from "../../src/kernel/tool.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { loadMcpConfig, mcpConfigPath } from "../../src/mcp/config.ts";
import { McpHost } from "../../src/mcp/host.ts";
import { ConfigError } from "../../src/shared/errors.ts";

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));
const directories: string[] = [];

const context: ToolContext = {
  sessionId: "test-session",
  workspace: "/tmp",
  scope: "read-only",
  target: "wsl",
  signal: new AbortController().signal,
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function dataDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "prism-mcp-"));
  directories.push(directory);
  return directory;
}

it("ships with zero servers when no configuration file exists", async () => {
  const directory = await dataDirectory();
  await expect(loadMcpConfig(directory)).resolves.toEqual({ servers: {} });
  expect(mcpConfigPath(directory)).toBe(join(directory, "mcp.json"));
});

it("reads stdio and HTTP servers from mcp.json", async () => {
  const directory = await dataDirectory();
  await writeFile(
    mcpConfigPath(directory),
    JSON.stringify({
      mcpServers: {
        local: {
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "secret" },
        },
        remote: { transport: "http", url: "http://127.0.0.1:8765/mcp" },
      },
    }),
  );

  await expect(loadMcpConfig(directory)).resolves.toEqual({
    servers: {
      local: {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: { TOKEN: "secret" },
      },
      remote: { transport: "http", url: "http://127.0.0.1:8765/mcp" },
    },
  });
});

it("reports invalid configuration instead of starting a broken server", async () => {
  const directory = await dataDirectory();
  const invalid = [
    "not json at all",
    JSON.stringify({ mcpServers: [] }),
    JSON.stringify({ mcpServers: { x: { transport: "carrier-pigeon" } } }),
    JSON.stringify({ mcpServers: { x: { transport: "stdio" } } }),
    JSON.stringify({ mcpServers: { x: { transport: "http" } } }),
  ];

  for (const content of invalid) {
    await writeFile(mcpConfigPath(directory), content);
    await expect(loadMcpConfig(directory)).rejects.toThrow(ConfigError);
    await expect(loadMcpConfig(directory)).rejects.toThrow(mcpConfigPath(directory));
  }
});

it("connects the servers named in the configuration file", async () => {
  const directory = await dataDirectory();
  await writeFile(
    mcpConfigPath(directory),
    JSON.stringify({
      mcpServers: {
        demo: { transport: "stdio", command: process.execPath, args: [fixture] },
      },
    }),
  );

  const host = await McpHost.connect(await loadMcpConfig(directory));
  try {
    const echo = host.tools.find((tool) => tool.name === "mcp__demo__echo");
    await expect(echo?.execute({ text: "from file" }, context)).resolves.toEqual({
      content: "echo: from file",
    });
  } finally {
    await host.close();
  }
});
