import type { BundleApi, Context, Tool } from "@prism/plugin-sdk";
import type { NotionDocument } from "./protocol.ts";
import { randomUUID } from "node:crypto";
import { PluginError } from "@prism/plugin-sdk";
import { isNotionDocument, isNotionUrl } from "./protocol.ts";

interface Connection {
  clientId: string;
  url: string;
}
interface Pending {
  sessionId: string;
  clientId: string;
  resolve: (document: NotionDocument) => void;
  reject: (error: Error) => void;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new PluginError("INVALID_INPUT", "请求格式无效。");
  return value as Record<string, unknown>;
}

export const inject = ["tools"];

export function apply(ctx: Context, api: BundleApi): void {
  const connections = new Map<string, Connection>();
  const pending = new Map<string, Pending>();
  const disconnect = (sessionId?: string): void => {
    for (const call of pending.values())
      if (sessionId === undefined || call.sessionId === sessionId)
        call.reject(
          new PluginError(
            "NOTION_DISCONNECTED",
            "Notion 页面已关闭或切换，请重新打开后再试。",
          ),
        );
    if (sessionId === undefined) connections.clear();
    else connections.delete(sessionId);
  };

  const request = (
    sessionId: string,
    kind: "read" | "apply",
    input: unknown,
    signal: AbortSignal,
  ): Promise<NotionDocument> => {
    signal.throwIfAborted();
    const connection = connections.get(sessionId);
    if (connection === undefined)
      return Promise.reject(
        new PluginError(
          "NOTION_NOT_OPEN",
          "请先从当前会话的 Notion 插件打开原生网页。",
        ),
      );
    const { clientId } = connection;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          fail(
            new PluginError(
              "NOTION_TIMEOUT",
              "Notion 页面未应答，请检查页面连接后重试。",
            ),
          ),
        15_000,
      );
      function cleanup(): void {
        pending.delete(id);
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
      function fail(error: Error): void {
        cleanup();
        api.emit("document.cancel", { id, clientId }, sessionId);
        reject(error);
      }
      function abort(): void {
        fail(new PluginError("CANCELLED", "Notion 操作已取消。"));
      }
      pending.set(id, {
        sessionId,
        clientId,
        resolve: (document) => {
          cleanup();
          resolve(document);
        },
        reject: fail,
      });
      signal.addEventListener("abort", abort, { once: true });
      api.emit("document.request", { id, clientId, kind, input }, sessionId);
    });
  };

  const tools: Tool[] = [
    {
      name: "notion_read",
      description:
        "Read the Notion native page currently open for this session, including visible text, selected text, an edit revision and whether an observed insertion point is available. Read before notion_apply. If Notion is not connected, report that explicitly.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute(_args, context) {
        try {
          return {
            content: JSON.stringify(
              await request(context.sessionId, "read", {}, context.signal),
            ),
          };
        } catch (error) {
          return {
            content: error instanceof Error ? error.message : String(error),
            isError: true,
          };
        }
      },
    },
    {
      name: "notion_apply",
      description:
        "Insert text at the user's captured Notion editing position, or replace the captured selection. First call notion_read and pass its revision. This cannot rewrite an entire page arbitrarily; the user must have placed a cursor or selected text before opening Prism AI. Stale pages and changed selections are refused.",
      parameters: {
        type: "object",
        properties: {
          revision: { type: "string" },
          text: { type: "string", minLength: 1, maxLength: 50_000 },
        },
        required: ["revision", "text"],
        additionalProperties: false,
      },
      effects: (_args, context) => [
        { kind: "command", command: "notion_apply: edit the captured Notion text" },
        {
          kind: "browser-action",
          action: "Edit the observed Notion selection",
          target: connections.get(context.sessionId)?.url ?? "https://app.notion.com/",
        },
      ],
      async execute(args, context) {
        try {
          const input = record(args);
          if (
            typeof input.revision !== "string" ||
            !/^[a-f0-9]{64}$/.test(input.revision) ||
            typeof input.text !== "string" ||
            input.text.length === 0 ||
            input.text.length > 50_000 ||
            Object.keys(input).some((key) => key !== "revision" && key !== "text")
          )
            throw new PluginError(
              "INVALID_INPUT",
              "需要刚读取的页面版本与 1–50000 字符的文本。",
            );
          return {
            content: JSON.stringify(
              await request(context.sessionId, "apply", input, context.signal),
            ),
          };
        } catch (error) {
          return {
            content: error instanceof Error ? error.message : String(error),
            isError: true,
          };
        }
      },
    },
  ];

  ctx.effect(function* () {
    yield () => disconnect();
    yield api.onSessionRemoved((sessionId) => {
      disconnect(sessionId);
      return Promise.resolve();
    });
    for (const tool of tools) yield ctx.tools.register(tool);
    yield api.rpc.register("document.ready", async (value, context) => {
      context.signal.throwIfAborted();
      const input = record(value);
      if (
        typeof input.clientId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(input.clientId) ||
        typeof input.url !== "string" ||
        !isNotionUrl(input.url)
      )
        throw new PluginError("INVALID_INPUT", "Notion 页面身份无效。");
      if (connections.get(context.sessionId)?.clientId !== input.clientId)
        disconnect(context.sessionId);
      connections.set(context.sessionId, { clientId: input.clientId, url: input.url });
      return { connected: true };
    });
    yield api.rpc.register("document.reply", async (value, context) => {
      context.signal.throwIfAborted();
      const input = record(value);
      const call = typeof input.id === "string" ? pending.get(input.id) : undefined;
      if (
        call === undefined ||
        call.sessionId !== context.sessionId ||
        call.clientId !== input.clientId
      )
        throw new PluginError("REQUEST_EXPIRED", "页面操作已过期或不属于此会话。", 409);
      if (input.error !== undefined) {
        const error = record(input.error);
        if (typeof error.message !== "string" || error.message.length > 2000)
          throw new PluginError("INVALID_INPUT", "页面错误格式无效。");
        call.reject(new PluginError("NOTION_PAGE_ERROR", error.message));
      } else {
        if (!isNotionDocument(input.document))
          throw new PluginError("INVALID_INPUT", "页面结果格式无效。");
        const connection = connections.get(context.sessionId);
        if (connection !== undefined) connection.url = input.document.url;
        call.resolve(input.document);
      }
      return { accepted: true };
    });
    yield api.rpc.register("document.detach", async (value, context) => {
      if (connections.get(context.sessionId)?.clientId === record(value).clientId)
        disconnect(context.sessionId);
      return { disconnected: true };
    });
  });
}
