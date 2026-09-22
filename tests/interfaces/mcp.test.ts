import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import type { TaskRunner } from "../../src/interfaces/mcp.ts";
import type { BrowserTaskOptions, BrowserTaskResult } from "../../src/runtime/task.ts";
import type { TextHelperResult } from "../../src/runtime/text-helper.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it, vi } from "vitest";
import { createPrismMcpServer } from "../../src/interfaces/mcp.ts";
import { ConfigError } from "../../src/shared/errors.ts";

const taskResult: BrowserTaskResult = {
  status: "done",
  reason: "The confirmation is visible.",
  finalUrl: "https://example.com/done",
  finalTitle: "Done",
  finalText: "Your message was sent",
  steps: 2,
  elapsedMs: 1_200,
};

async function connect(runTask: TaskRunner, capabilities?: ClientCapabilities) {
  const server = createPrismMcpServer(runTask);
  const client = new Client(
    { name: "prism-test", version: "0.0.0" },
    capabilities === undefined ? {} : { capabilities },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function textOf(response: Record<string, unknown>): string {
  const content = response.content;
  if (!Array.isArray(content)) return "";
  const first = content[0] as { type?: unknown; text?: unknown } | undefined;
  return first?.type === "text" && typeof first.text === "string" ? first.text : "";
}

describe("prism MCP server", () => {
  it("exposes one task-level browser tool", async () => {
    const runTask = vi.fn<TaskRunner>(async () => taskResult);
    const client = await connect(runTask);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["browser_task"]);

    const response = await client.callTool({
      name: "browser_task",
      arguments: { url: "https://example.com", goal: "Send the message", max_steps: 5 },
    });

    expect(response.isError).toBeFalsy();
    expect(runTask).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://example.com",
        goal: "Send the message",
        maxSteps: 5,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(textOf(response)).toContain("status: done");
    expect(textOf(response)).toContain("Your message was sent");
    expect(response.structuredContent).toMatchObject({
      status: "done",
      steps: 2,
    });
  });

  it("forwards the caller abort signal", async () => {
    let received: BrowserTaskOptions | undefined;
    const runTask: TaskRunner = async (options) => {
      received = options;
      return taskResult;
    };
    const client = await connect(runTask);

    await client.callTool({
      name: "browser_task",
      arguments: { url: "https://example.com", goal: "Send the message" },
    });

    expect(received?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a tool error when the run cannot start", async () => {
    const runTask: TaskRunner = async () => {
      throw new ConfigError("TYPESAFE_API_KEY is required for task decisions.");
    };
    const client = await connect(runTask);

    const response = await client.callTool({
      name: "browser_task",
      arguments: { url: "https://example.com", goal: "Send the message" },
    });

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain("TYPESAFE_API_KEY");
  });

  it("answers field text through the host model when the client supports sampling", async () => {
    let helper: TextHelperResult | undefined;
    const runTask: TaskRunner = async (options) => {
      helper = await options.fieldText!({
        goal: "Send an email",
        field: { label: "Email" },
        page: { title: "Contact", text: "Email address" },
        recent_actions: [],
      });
      return taskResult;
    };
    const client = await connect(runTask, { sampling: {} });

    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      expect(request.params.systemPrompt).toContain("exactly one key");
      const content = request.params.messages[0]!.content;
      const block = Array.isArray(content) ? content[0]! : content;
      expect(block.type).toBe("text");
      expect(JSON.parse((block as { text: string }).text)).toMatchObject({
        goal: "Send an email",
        field: { label: "Email" },
      });
      return {
        role: "assistant" as const,
        content: { type: "text" as const, text: '{"text":"host@example.com"}' },
        model: "host-model",
      };
    });

    const response = await client.callTool({
      name: "browser_task",
      arguments: { url: "https://example.com", goal: "Send the email" },
    });

    expect(response.isError).toBeFalsy();
    expect(helper?.text).toBe("host@example.com");
    expect(helper?.model).toBe("host-model");
  });

  it("leaves field text to the environment when the client has no sampling", async () => {
    let received: BrowserTaskOptions | undefined;
    const runTask: TaskRunner = async (options) => {
      received = options;
      return taskResult;
    };
    const client = await connect(runTask);

    await client.callTool({
      name: "browser_task",
      arguments: { url: "https://example.com", goal: "Send the message" },
    });

    expect(received?.fieldText).toBeUndefined();
  });
});
