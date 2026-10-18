import type { Tool, ToolContext } from "../../src/kernel/tool.ts";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { McpHost } from "../../src/mcp/host.ts";

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));

const context: ToolContext = {
  sessionId: "test-session",
  workspace: "/tmp",
  scope: "read-only",
  target: "wsl",
  signal: new AbortController().signal,
};

describe("McpHost over stdio", () => {
  let host: McpHost | undefined;

  afterEach(async () => {
    await host?.close();
    host = undefined;
  });

  it("exposes a configured server's tools as kernel tools and executes them", async () => {
    host = await connectDemo();

    const echo = findTool(host, "mcp__demo__echo");
    expect(echo.description).toBe("Echoes the given text back.");
    expect(echo.parameters).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });

    await expect(echo.execute({ text: "hello" }, context)).resolves.toEqual({
      content: "echo: hello",
    });
  });

  it("returns tool failures as results instead of throwing", async () => {
    host = await connectDemo();

    const exploding = findTool(host, "mcp__demo__explode");
    const failed = await exploding.execute({}, context);
    expect(failed.isError).toBe(true);
    expect(failed.content).toContain("tool exploded");

    const killing = findTool(host, "mcp__demo__kill");
    const lost = await killing.execute({}, context);
    expect(lost.isError).toBe(true);
    expect(lost.content).toContain("mcp__demo__kill");

    const echo = findTool(host, "mcp__demo__echo");
    const malformed = await echo.execute("not an object", context);
    expect(malformed.isError).toBe(true);
    expect(malformed.content).toContain("mcp__demo__echo");
  });

  it("keeps working servers when another server fails to start", async () => {
    host = await McpHost.connect({
      servers: {
        good: { transport: "stdio", command: process.execPath, args: [fixture] },
        broken: {
          transport: "stdio",
          command: process.execPath,
          args: [fixture, "crash"],
        },
      },
    });

    expect(host.tools.map((tool) => tool.name)).toContain("mcp__good__echo");
    expect(host.failures).toHaveLength(1);
    expect(host.failures[0]?.server).toBe("broken");
    expect(host.failures[0]?.message).toContain("fake server: refused to start");

    const echo = findTool(host, "mcp__good__echo");
    await expect(echo.execute({ text: "still alive" }, context)).resolves.toEqual({
      content: "echo: still alive",
    });
  });

  it("gives up on a server that never answers and reports why", async () => {
    const started = Date.now();
    host = await McpHost.connect(
      {
        servers: {
          mute: {
            transport: "stdio",
            command: process.execPath,
            args: ["-e", "setTimeout(() => {}, 60000)"],
          },
        },
      },
      { connectTimeoutMs: 300 },
    );

    expect(host.tools).toEqual([]);
    expect(host.failures).toHaveLength(1);
    expect(host.failures[0]?.server).toBe("mute");
    expect(host.failures[0]?.message).toMatch(/timed out/i);
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});

async function connectDemo(): Promise<McpHost> {
  return McpHost.connect({
    servers: {
      demo: { transport: "stdio", command: process.execPath, args: [fixture] },
    },
  });
}

function findTool(host: McpHost, name: string): Tool {
  const tool = host.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Tool ${name} is missing from the host.`);
  return tool;
}
