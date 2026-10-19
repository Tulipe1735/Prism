import type { AddressInfo } from "node:net";
import type { ToolContext } from "../../src/kernel/tool.ts";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { expect, it } from "vitest";
import { z } from "zod";
import { PermissionPolicy } from "../../src/kernel/permissions.ts";
import { McpHost } from "../../src/mcp/host.ts";

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));

const context: ToolContext = {
  sessionId: "test-session",
  workspace: "/tmp",
  scope: "read-only",
  permissions: new PermissionPolicy({
    scope: "read-only",
    browserActionsNeedApproval: false,
  }),
  target: "wsl",
  signal: new AbortController().signal,
  requestApproval: async () => false,
};

it("connects to an HTTP MCP server and calls its tools", async () => {
  const mcpServer = new McpServer({ name: "fake-http", version: "0.0.0" });
  mcpServer.registerTool(
    "add",
    {
      description: "Adds two numbers.",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
  );
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcpServer.connect(transport);
  const httpServer = await serveHttp(transport);

  const host = await McpHost.connect({
    servers: {
      remote: { transport: "http", url: `http://127.0.0.1:${httpServer.port}/mcp` },
    },
  });
  try {
    const add = host.tools.find((tool) => tool.name === "mcp__remote__add");
    expect(add).toBeDefined();
    expect(add?.parameters).toMatchObject({
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    });
    await expect(add?.execute({ a: 2, b: 3 }, context)).resolves.toEqual({
      content: "5",
    });
    expect(host.failures).toEqual([]);
  } finally {
    await host.close();
    await httpServer.close();
  }
});

it("reports an unreachable HTTP server without breaking reachable ones", async () => {
  const host = await McpHost.connect({
    servers: {
      good: { transport: "stdio", command: process.execPath, args: [fixture] },
      unreachable: { transport: "http", url: "http://127.0.0.1:1/mcp" },
    },
  });
  try {
    expect(host.tools.map((tool) => tool.name)).toContain("mcp__good__echo");
    expect(host.failures.map((failure) => failure.server)).toEqual(["unreachable"]);
    expect(host.failures[0]?.message).not.toBe("");
  } finally {
    await host.close();
  }
});

async function serveHttp(
  transport: StreamableHTTPServerTransport,
): Promise<{ port: number; close: () => Promise<void> }> {
  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body = chunks.length
      ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown)
      : undefined;
    await transport.handleRequest(request, response, body);
  };
  const server: Server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) =>
      console.error("fake http server failed", error),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: async () => {
      await transport.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
