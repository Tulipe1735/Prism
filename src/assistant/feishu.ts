import type { AssistantConfig } from "./config.ts";
import type { PersonalAssistant, SendMessage } from "./service.ts";
import type { AssistantStore } from "./store.ts";
import type { TaskRecord } from "./types.ts";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import * as Lark from "@larksuiteoapi/node-sdk";

/** Two applications, one owner, one shared store. No public webhook is needed. */
export function createFeishu(config: AssistantConfig): {
  send: SendMessage;
  start: (
    app: PersonalAssistant,
    store: AssistantStore,
    cancel: (id: string) => TaskRecord,
  ) => void;
  close: () => void;
} {
  const clients = config.feishu.map((bot) => ({
    ...bot,
    client: new Lark.Client({
      appId: bot.appId,
      appSecret: bot.appSecret,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.error,
    }),
  }));
  const connections: Lark.WSClient[] = [];
  const send: SendMessage = async (body, key, role) => {
    const bot = clients.find((b) => b.role === role);
    if (!bot) throw new Error(`未配置 ${role} 飞书机器人`);
    const ids: string[] = [];
    // Bound messages by UTF-8 bytes, including CJK; stable UUID per chunk is
    // also sent to the provider as an additional short-window deduplication key.
    const chunks: string[] = [];
    let part = "";
    for (const character of body) {
      if (Buffer.byteLength(part + character) > 16_000) {
        chunks.push(part);
        part = "";
      }
      part += character;
    }
    if (part) chunks.push(part);
    for (let index = 0; index < chunks.length; index++) {
      const response = await bot.client.im.v1.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: bot.chatId,
          msg_type: "text",
          content: JSON.stringify({ text: chunks[index] }),
          uuid: createHash("sha256")
            .update(`${role}:${key}:${index}`)
            .digest("hex")
            .slice(0, 32),
        },
      });
      if (response.code !== 0 || !response.data?.message_id)
        throw new Error("飞书未确认交付");
      ids.push(response.data.message_id);
    }
    return { id: ids.join(",") };
  };
  return {
    send,
    start(
      app: PersonalAssistant,
      store: AssistantStore,
      cancel: (id: string) => TaskRecord,
    ) {
      for (const bot of clients) {
        const ws = new Lark.WSClient({
          appId: bot.appId,
          appSecret: bot.appSecret,
          domain: Lark.Domain.Feishu,
          loggerLevel: Lark.LoggerLevel.error,
        });
        const dispatcher = new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (event) => {
            if (
              event.sender.sender_type !== "user" ||
              !config.allowedOpenIds.includes(event.sender.sender_id?.open_id ?? "") ||
              event.message.chat_id !== bot.chatId ||
              event.message.message_type !== "text"
            )
              return;
            let text: string;
            try {
              text = String(JSON.parse(event.message.content).text).trim();
            } catch {
              return;
            }
            const id = `feishu:${event.message.message_id}`;
            const say = (body: string): Promise<{ id: string }> =>
              send(body, id, bot.role);
            try {
              if (text === "/help") {
                await say(
                  "直接提问；/deep 问题：深入研究（≤20分钟）\n/status 任务ID、/cancel 任务ID\n/memory、/progress 研究进展、/correct 纠正规则\n/confirm-memory 记录ID、/forget 记录ID\n/confirm 本地任务ID（先核对原样指令）\n/sync、/budget",
                );
                return;
              }
              if (text === "/memory") {
                await say(JSON.stringify(store.listMemory(), null, 2));
                return;
              }
              if (text === "/budget") {
                await say(JSON.stringify(store.budget(), null, 2));
                return;
              }
              if (text === "/sync") {
                await say(JSON.stringify(await app.sync(), null, 2));
                return;
              }
              if (text.startsWith("/status ")) {
                const task = store.getTask(text.slice(8).trim());
                await say(
                  task
                    ? JSON.stringify(
                        {
                          id: task.id,
                          status: task.status,
                          events: task.events.slice(-8),
                          costCny: task.costCny,
                          answer: task.answer,
                        },
                        null,
                        2,
                      )
                    : "任务不存在",
                );
                return;
              }
              if (text.startsWith("/cancel ")) {
                await say(JSON.stringify(cancel(text.slice(8).trim()), null, 2));
                return;
              }
              if (text.startsWith("/confirm ")) {
                await say(JSON.stringify(app.approve(text.slice(9).trim()), null, 2));
                return;
              }
              if (text.startsWith("/forget ")) {
                store.deleteMemory(text.slice(8).trim());
                await say("记录已删除，后续任务不再采用。");
                return;
              }
              if (text.startsWith("/confirm-memory ")) {
                const memory = store
                  .listMemory()
                  .find((m) => m.id === text.slice(16).trim());
                if (!memory) {
                  await say("记录不存在");
                  return;
                }
                store.upsertMemory(
                  {
                    ...memory,
                    status: "confirmed",
                    updatedAt: new Date().toISOString(),
                  },
                  memory.updatedAt,
                );
                await say(`已确认：${memory.text}`);
                return;
              }
              if (text.startsWith("/progress ") || text.startsWith("/correct ")) {
                const existing = store.listMemory().find((entry) => entry.id === id);
                if (existing) {
                  await say(`已保存：${existing.text}`);
                  return;
                }
                const now = new Date().toISOString();
                const progress = text.startsWith("/progress ");
                store.upsertMemory({
                  id,
                  kind: progress ? "progress" : "correction",
                  text: text.slice(progress ? 10 : 9).trim(),
                  status: "confirmed",
                  createdAt: now,
                  updatedAt: now,
                });
                await say("已保存；两个角色的后续任务都会使用这项更新。");
                return;
              }
              const task = app.submit({
                id,
                role: bot.role,
                effort: text.startsWith("/deep ") ? "deep" : "normal",
                message: text.replace(/^\/deep\s+/, ""),
                conversationId: `${bot.role}:${bot.chatId}`,
                source: `feishu:${bot.role}:${bot.chatId}`,
              });
              await say(
                `已接收 ${task.id} · ${task.effort === "deep" ? "深入研究，最长20分钟" : "普通问答"}\n可用 /status ${task.id} 查询进度。`,
              );
            } catch {
              await say("操作未完成，请检查任务状态或授权配置；没有自动重复外部操作。");
            }
          },
        });
        ws.start({ eventDispatcher: dispatcher });
        connections.push(ws);
      }
    },
    close() {
      for (const connection of connections) connection.close({ force: true });
    },
  };
}
