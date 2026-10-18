import type { PersonalAssistant } from "./service.ts";
import type { AssistantStore } from "./store.ts";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { z } from "zod";

const taskInput = z
  .object({
    message: z.string().min(1).max(30_000),
    role: z.enum(["intelligence", "qa"]).optional(),
    effort: z.enum(["normal", "deep"]).optional(),
    conversationId: z.string().max(200).optional(),
    id: z.string().min(1).max(200).optional(),
    confirmedMemoryIds: z.array(z.string()).max(20).optional(),
  })
  .strict();
const authenticate = (actual: string | undefined, expected: string): boolean => {
  if (!expected || !actual?.startsWith("Bearer ")) return false;
  const left = Buffer.from(actual.slice(7));
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};
async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 1_000_000) throw new Error("请求超过1MB，请在服务所在设备手动导入文件");
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createAssistantServer(options: {
  store: AssistantStore;
  app: PersonalAssistant;
  ownerToken: string;
  workerToken: string;
  cancel: (id: string) => unknown;
}): Server {
  const { store, app } = options;
  if (
    options.ownerToken.length < 24 ||
    options.workerToken.length < 24 ||
    options.ownerToken === options.workerToken
  )
    throw new Error("服务需要两个不同的至少24字符令牌");
  return createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const reply = (status: number, value: unknown): void => {
      response.writeHead(status);
      response.end(JSON.stringify(value));
    };
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent);
      if (request.method === "GET" && path.join("/") === "health")
        return reply(200, { ok: true });
      const worker = path[0] === "worker";
      if (
        !authenticate(
          request.headers.authorization,
          worker ? options.workerToken : options.ownerToken,
        )
      )
        return reply(401, { error: "未授权" });
      if (worker) {
        if (request.method === "POST" && path[1] === "next" && path.length === 2) {
          const { workerId } = z
            .object({ workerId: z.string().min(1).max(200) })
            .strict()
            .parse(await body(request));
          return reply(200, { job: store.claimLocal(workerId) ?? null });
        }
        if (
          request.method === "POST" &&
          path[1] === "jobs" &&
          path[2] &&
          path.length === 3
        ) {
          const input = z
            .object({
              workerId: z.string(),
              status: z.enum(["completed", "unknown", "failed"]),
              result: z.unknown(),
            })
            .strict()
            .parse(await body(request));
          const job = store.getLocalJob(path[2]);
          if (
            job?.workerId === input.workerId &&
            job.status === input.status &&
            JSON.stringify(job.result) === JSON.stringify(input.result)
          )
            return reply(200, { accepted: true, duplicate: true });
          if (!job || job.workerId !== input.workerId || job.status !== "claimed")
            return reply(409, { error: "任务未由本工作端领取，或结果已提交" });
          // Acknowledge the receipt before continuing the potentially long model loop.
          void app
            .completeLocal(job.id, input.result, input.status)
            .catch(() => console.error("本地结果续跑失败，可通过任务状态查看"));
          return reply(202, { accepted: true });
        }
        return reply(404, { error: "工作端接口不存在" });
      }
      if (request.method === "POST" && path.join("/") === "tasks")
        return reply(
          202,
          app.submit({ ...taskInput.parse(await body(request)), source: "http" }),
        );
      if (request.method === "GET" && path[0] === "tasks")
        return reply(
          200,
          path[1]
            ? (store.getTask(path[1]) ?? { error: "任务不存在" })
            : store.listTasks(),
        );
      if (
        request.method === "POST" &&
        path[0] === "tasks" &&
        path[1] &&
        path[2] === "cancel"
      )
        return reply(200, options.cancel(path[1]));
      if (request.method === "GET" && path.join("/") === "budget")
        return reply(200, store.budget());
      if (request.method === "GET" && path[0] === "memory")
        return reply(200, store.listMemory());
      if (request.method === "DELETE" && path[0] === "memory" && path[1]) {
        store.deleteMemory(path[1]);
        return reply(200, { deleted: true });
      }
      if (request.method === "PUT" && path[0] === "memory" && path[1]) {
        const input = z
          .object({
            text: z.string().min(1).max(10_000),
            status: z.enum(["confirmed", "tentative"]),
            expectedUpdatedAt: z.string(),
          })
          .strict()
          .parse(await body(request));
        const previous = store.listMemory().find((m) => m.id === path[1]);
        if (!previous) return reply(404, { error: "记录不存在" });
        store.upsertMemory(
          {
            ...previous,
            text: input.text,
            status: input.status,
            updatedAt: new Date().toISOString(),
          },
          input.expectedUpdatedAt,
        );
        return reply(
          200,
          store.listMemory().find((m) => m.id === path[1]),
        );
      }
      if (request.method === "GET" && path[0] === "library") {
        if (path[1] === "search")
          return reply(
            200,
            store.search(
              new URL(request.url!, "http://localhost").searchParams.get("q") ?? "",
            ),
          );
        return reply(
          200,
          store.listDocuments().map(({ content: _content, ...doc }) => doc),
        );
      }
      if (request.method === "DELETE" && path[0] === "library" && path[1]) {
        store.removeDocument(path[1]);
        return reply(200, { deleted: true });
      }
      if (request.method === "POST" && path.join("/") === "sync")
        return reply(200, await app.sync());
      if (request.method === "POST" && path.join("/") === "brief")
        return reply(200, await app.prepareBrief());
      if (request.method === "GET" && path.join("/") === "deliveries")
        return reply(200, store.listDeliveries());
      if (request.method === "POST" && path[0] === "deliveries" && path[1]) {
        const input = z
          .object({
            status: z.enum(["sent", "pending"]),
            evidence: z.string().min(1).max(2000),
          })
          .strict()
          .parse(await body(request));
        if (store.getDelivery(path[1])?.status !== "unknown")
          return reply(409, { error: "只可核对结果未知的交付" });
        store.updateDelivery(path[1], {
          status: input.status,
          error: `用户核对：${input.evidence}`,
        });
        return reply(200, store.getDelivery(path[1]));
      }
      if (
        request.method === "POST" &&
        path[0] === "local" &&
        path[1] &&
        path[2] === "confirm"
      )
        return reply(200, app.approve(path[1]));
      if (request.method === "GET" && path[0] === "local" && path[1])
        return reply(200, store.getLocalJob(path[1]) ?? { error: "任务不存在" });
      return reply(404, { error: "接口不存在" });
    } catch (error) {
      // Do not serialize provider exceptions, credentials, or stack traces.
      return reply(400, {
        error:
          error instanceof z.ZodError
            ? "请求格式不正确"
            : error instanceof Error &&
                !/token|secret|key|authorization/i.test(error.message)
              ? error.message.slice(0, 500)
              : "操作失败，请查看任务记录",
      });
    }
  });
}
