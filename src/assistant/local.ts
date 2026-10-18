import type { Buffer } from "node:buffer";
import type { LocalJob } from "./types.ts";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { commandSchema } from "../cli/protocol.ts";

export async function executePrism(
  job: LocalJob,
  options: { browserUrl: string; cliPath: string; stateDirectory: string },
): Promise<{ status: "completed" | "unknown" | "failed"; result: unknown }> {
  if (job.command.approved !== true) throw new Error("任务尚未获得确认");
  const raw = job.command.prism;
  if (!raw || typeof raw !== "object") throw new Error("无效本地命令");
  const command = commandSchema.parse(raw);
  if (command.command === "ping" || command.command === "shutdown")
    throw new Error("不允许该本地命令");
  const argv = [
    options.cliPath,
    ...(command.command === "open" || command.command === "close"
      ? ["session", command.command]
      : [command.command]),
    "--state-dir",
    options.stateDirectory,
    "--json",
  ];
  if (command.command === "open") {
    const url = new URL(command.url);
    if (
      url.protocol !== "https:" ||
      !(url.hostname === "nwpu.edu.cn" || url.hostname.endsWith(".nwpu.edu.cn"))
    )
      throw new Error("只允许西工大门户域名");
    const browser = new URL(options.browserUrl);
    if (
      browser.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(browser.hostname)
    )
      throw new Error("浏览器调试入口必须是本机地址");
    argv.push("--url", command.url, "--browser-url", options.browserUrl);
  } else if (command.command !== "act") {
    argv.push("--session", command.session);
    if (command.command === "observe" || command.command === "context")
      argv.push("--scope", command.scope);
    if (command.command === "context")
      argv.push("--observation", command.observation, "--target", command.target);
    if (command.command === "receipt") argv.push("--request-id", command.request_id);
  } else argv.push("--stdin");
  const remaining = job.deadlineAt ? Date.parse(job.deadlineAt) - Date.now() : 60_000;
  if (!(remaining > 0))
    return {
      status: "failed",
      result: { error: "深入任务已达到时间上限，本地命令未执行。" },
    };
  return new Promise((done) => {
    const child = spawn(process.execPath, argv, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    let oversized = false;
    const timeout = setTimeout(() => child.kill(), Math.min(60_000, remaining));
    child.stdout.on("data", (value: Buffer) => {
      output += value.toString("utf8");
      if (output.length > 2_000_000) {
        oversized = true;
        child.kill();
      }
    });
    // Drain stderr without forwarding potentially sensitive browser details.
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timeout);
      done({ status: "failed", result: { error: "Prism 无法启动，请检查安装路径" } });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      let result: unknown;
      try {
        result = JSON.parse(output);
      } catch {
        result = {
          error: oversized
            ? "观察结果过大，请缩小范围"
            : "Prism 未返回有效回执，请查询 receipt 和页面状态",
        };
      }
      const unknown =
        command.command === "act" &&
        (code !== 0 ||
          !output ||
          JSON.stringify(result).includes('"outcome":"unknown"'));
      done({
        status: unknown ? "unknown" : code === 0 ? "completed" : "failed",
        result,
      });
    });
    child.stdin.end(command.command === "act" ? JSON.stringify(command) : undefined);
  });
}

export async function runLocalWorker(options: {
  server: string;
  token: string;
  browserUrl: string;
  cliPath: string;
  directory: string;
  signal: AbortSignal;
  loggedIn: boolean;
}): Promise<void> {
  if (!options.loggedIn)
    throw new Error("请先登录翱翔门户，再用 --logged-in 启动工作端");
  const server = new URL(options.server);
  if (
    server.protocol !== "https:" &&
    !["127.0.0.1", "localhost", "[::1]"].includes(server.hostname)
  )
    throw new Error("远程工作端连接必须使用 HTTPS");
  const workerId = `${hostname()}:${randomUUID()}`;
  const journal = resolve(options.directory, "worker-pending.json");
  await mkdir(options.directory, { recursive: true, mode: 0o700 });
  const post = async (path: string, value: unknown): Promise<unknown> => {
    const reply = await fetch(new URL(path, server), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(value),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]),
    });
    if (!reply.ok) throw new Error(`工作端请求失败 HTTP ${reply.status}`);
    return reply.json();
  };
  // Reconcile the previous receipt before accepting another command. A crash
  // before the receipt was journalled means unknown, never a second execution.
  try {
    const pending = JSON.parse(await readFile(journal, "utf8"));
    await post(`/worker/jobs/${encodeURIComponent(pending.id)}`, {
      workerId: pending.workerId,
      status: pending.status ?? "unknown",
      result: pending.result ?? { error: "工作端曾中断，请先查回执及页面效果" },
    });
    await unlink(journal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  while (!options.signal.aborted) {
    try {
      const response = (await post("/worker/next", { workerId })) as {
        job: LocalJob | null;
      };
      if (response.job) {
        const job = response.job;
        await writeFile(journal, JSON.stringify({ id: job.id, workerId }), {
          mode: 0o600,
        });
        const outcome = await executePrism(job, {
          browserUrl: options.browserUrl,
          cliPath: options.cliPath,
          stateDirectory: resolve(options.directory, "prism"),
        });
        const receipt = { id: job.id, workerId, ...outcome };
        await writeFile(journal, JSON.stringify(receipt), { mode: 0o600 });
        await post(`/worker/jobs/${encodeURIComponent(job.id)}`, {
          workerId,
          ...outcome,
        });
        await unlink(journal);
        continue;
      }
    } catch {
      if (!options.signal.aborted)
        console.error("本地工作端连接中断；先交回待处理回执，再领取其他任务。");
      // Keep the journal authoritative after a failed receipt upload. Stop rather
      // than overwriting it with another job on the next poll.
      try {
        await readFile(journal);
        return;
      } catch {
        /* No claimed job. Reconnect. */
      }
    }
    await new Promise<void>((done) => {
      const timer = setTimeout(done, 5000);
      options.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          done();
        },
        { once: true },
      );
    });
  }
}
