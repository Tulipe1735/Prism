#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { initializeResearch } from "./bootstrap.ts";
import { loadConfig } from "./config.ts";
import {
  ArxivSource,
  GitHubTrending,
  GmailSource,
  NotionSource,
} from "./connectors.ts";
import { courseMaterials } from "./courses.ts";
import { DeepSeekModel } from "./deepseek.ts";
import { createFeishu } from "./feishu.ts";
import { createAssistantServer } from "./http.ts";
import { KnowledgeLibrary } from "./library.ts";
import { runLocalWorker } from "./local.ts";
import { AssistantRuntime } from "./runtime.ts";
import { assistantTools, PersonalAssistant, type Sources } from "./service.ts";
import { AssistantStore } from "./store.ts";

const HELP = `Prism · 个人研究助手（Node >=22.19）

prism-agent init                       初始化研究起点与本地持久目录
prism-agent doctor                     检查配置（不调用付费模型）
prism-agent serve                      云端服务、飞书长连接、10:00晨报
prism-agent ask "问题" [--deep]         普通问答或最长20分钟的方法对比
prism-agent import <file...>            导入 Markdown、文本PDF、简历
prism-agent sync                       Notion → Markdown → 资料库
prism-agent brief                      手动准备今日晨报（不提前推送）
prism-agent status [task-id]            查看任务、进度和费用
prism-agent memory                     查看共享研究状态
prism-agent forget <memory-id>          删除状态/纠正规则
prism-agent delete <document-id>        删除资料及可检索内容
prism-agent confirm <local-job-id>      确认已核对的本地原样指令
prism-agent local-worker --logged-in --server <https://...>
                                      开机且门户已登录后启动本地工作端

从 .env 载入配置：node --env-file=.env dist/agent.js <command>
首次设置及费用边界见 docs/assistant.md。`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      deep: { type: "boolean" },
      "logged-in": { type: "boolean" },
      server: { type: "string" },
      "browser-url": { type: "string" },
    },
    strict: true,
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return;
  }
  const config = loadConfig();
  if (command === "doctor") {
    console.log(
      JSON.stringify(
        {
          node: process.version,
          directory: config.directory,
          deepseek: {
            configured: !!config.deepseek.apiKey,
            model: config.deepseek.model,
          },
          notion: !!config.notionToken,
          gmail: !!config.gmail,
          feishu: config.feishu.map((bot) => bot.role),
          ownerToken: config.ownerToken.length >= 24,
          workerToken:
            config.workerToken.length >= 24 && config.workerToken !== config.ownerToken,
          budget: {
            limitCny: config.budgetCny,
            infrastructureCny: config.infrastructureCny,
            modelAllowanceCny: config.budgetCny - config.infrastructureCny,
          },
          note: "配置检查不代表真实接入成功；固定费用须填写实际月费。",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "local-worker") {
    if (!values.server || !config.workerToken)
      throw new Error("工作端需要 --server 与 ASSISTANT_WORKER_TOKEN");
    const abort = new AbortController();
    process.once("SIGINT", () => abort.abort());
    process.once("SIGTERM", () => abort.abort());
    const here = dirname(fileURLToPath(import.meta.url));
    const cliPath = existsSync(resolve(here, "cli.js"))
      ? resolve(here, "cli.js")
      : resolve(here, "../interfaces/cli.ts");
    await runLocalWorker({
      server: values.server,
      token: config.workerToken,
      browserUrl: values["browser-url"] ?? "http://127.0.0.1:9222",
      cliPath,
      directory: resolve(config.directory, "local"),
      signal: abort.signal,
      loggedIn: values["logged-in"] ?? false,
    });
    return;
  }
  const store = new AssistantStore(config.directory, {
    budgetCny: config.budgetCny,
    infrastructureCny: config.infrastructureCny,
  });
  const library = new KnowledgeLibrary(store);
  try {
    if (command === "init") {
      initializeResearch(store);
      console.log(`已初始化：${config.directory}`);
      return;
    }
    if (command === "import") {
      if (!rest.length) throw new Error("请提供要导入的文件");
      for (const file of rest) {
        const doc = await library.importFile(resolve(file));
        console.log(
          JSON.stringify({ id: doc.id, title: doc.title, metadata: doc.metadata }),
        );
      }
      return;
    }
    if (command === "status") {
      console.log(
        JSON.stringify(
          rest[0]
            ? store.getTask(rest[0])
            : {
                tasks: store.listTasks(),
                budget: store.budget(),
                deliveries: store.listDeliveries(),
              },
          null,
          2,
        ),
      );
      return;
    }
    if (command === "memory") {
      console.log(JSON.stringify(store.listMemory(), null, 2));
      return;
    }
    if (command === "forget" || command === "delete") {
      if (!rest[0]) throw new Error("请提供记录ID");
      if (command === "forget") store.deleteMemory(rest[0]);
      else store.removeDocument(rest[0]);
      console.log("已删除");
      return;
    }
    if (command === "confirm") {
      if (!rest[0]) throw new Error("请提供待确认的本地任务ID");
      console.log(JSON.stringify(store.approveLocal(rest[0]), null, 2));
      return;
    }
    const sources: Sources = {
      trending: new GitHubTrending(),
      arxiv: new ArxivSource(),
      ...(config.notionToken
        ? { notion: new NotionSource({ token: config.notionToken }) }
        : {}),
      ...(config.gmail ? { gmail: new GmailSource(config.gmail) } : {}),
    };
    if (command === "sync") {
      if (!sources.notion) throw new Error("请先设置 NOTION_TOKEN");
      console.log(JSON.stringify(await sources.notion.sync(store), null, 2));
      return;
    }
    if (!["ask", "brief", "serve"].includes(command))
      throw new Error("未知命令，请使用 --help");
    if (!config.deepseek.apiKey) throw new Error("请先设置 DEEPSEEK_API_KEY");
    const model = new DeepSeekModel(config.deepseek);
    const runtime = new AssistantRuntime({
      store,
      model,
      tools: [...assistantTools(store, sources), courseMaterials(store)],
      pricing: {
        input: config.deepseek.input,
        output: config.deepseek.output,
        cacheHit: config.deepseek.cacheHit,
      },
    });
    if (command === "ask") {
      if (!rest.length) throw new Error("请输入问题");
      const task = await runtime.ask({
        message: rest.join(" "),
        effort: values.deep ? "deep" : "normal",
        source: "cli",
      });
      console.log(task.answer || task.error || task.status);
      console.log(
        `\n任务 ${task.id} · ${task.status} · 估算¥${task.costCny.toFixed(4)}`,
      );
      return;
    }
    const feishu = createFeishu(config);
    const app = new PersonalAssistant({
      store,
      runtime,
      sources,
      send: config.feishu.length ? feishu.send : undefined,
    });
    if (command === "brief") {
      console.log(JSON.stringify(await app.prepareBrief(), null, 2));
      return;
    }
    if (process.env.ASSISTANT_INFRASTRUCTURE_CNY === undefined)
      throw new Error(
        "启动云端前请填写 ASSISTANT_INFRASTRUCTURE_CNY，固定月费与API一起计入50元上限",
      );
    const server = createAssistantServer({
      store,
      app,
      ownerToken: config.ownerToken,
      workerToken: config.workerToken,
      cancel: (id) => runtime.cancel(id),
    });
    await new Promise<void>((done) => server.listen(config.port, config.host, done));
    app.recover();
    feishu.start(app, store, (id) => runtime.cancel(id));
    const tick = (): void => {
      if (config.feishu.some((bot) => bot.role === "intelligence"))
        app.scheduleTick();
    };
    const timer = setInterval(tick, 30_000);
    tick();
    console.log(
      `个人助手已启动：${config.host}:${config.port}；晨报按北京时间10:00交付。`,
    );
    await new Promise<void>((done) => {
      const stop = (): void => {
        clearInterval(timer);
        feishu.close();
        server.close(() => done());
        for (const task of store.listTasks())
          if (task.status === "running") runtime.cancel(task.id);
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    await app.drain();
  } finally {
    store.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "操作失败");
    process.exitCode = 1;
  });
}
