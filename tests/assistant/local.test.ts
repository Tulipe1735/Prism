import type { LocalJob } from "../../src/assistant/types.ts";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { executePrism, runLocalWorker } from "../../src/assistant/local.ts";

it("uses the public Prism CLI with argument isolation and does not execute unconfirmed actions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism local worker "));
  const cliPath = join(directory, "public cli.mjs");
  await writeFile(
    cliPath,
    `const args=process.argv.slice(2); if(args[0]!=="session"||args[1]!=="open"||!args.includes("--state-dir")||!args.includes("--browser-url")) process.exit(2); console.log(JSON.stringify({ok:true,args}));`,
  );
  const job: LocalJob = {
    id: "local-1",
    taskId: "task-1",
    status: "claimed",
    createdAt: "now",
    updatedAt: "now",
    command: {
      approved: true,
      prism: {
        command: "open",
        url: "https://portal.nwpu.edu.cn/",
        browser_url: "http://127.0.0.1:9222",
      },
    },
  };
  try {
    const outcome = await executePrism(job, {
      cliPath,
      browserUrl: "http://127.0.0.1:9222",
      stateDirectory: directory,
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.result).toMatchObject({ ok: true });
    await expect(
      executePrism(
        { ...job, command: { ...job.command, approved: false } },
        { cliPath, browserUrl: "http://127.0.0.1:9222", stateDirectory: directory },
      ),
    ).rejects.toThrow("确认");
    await expect(
      executePrism(
        { ...job, command: { approved: true, prism: { command: "shutdown" } } },
        { cliPath, browserUrl: "http://127.0.0.1:9222", stateDirectory: directory },
      ),
    ).rejects.toThrow("不允许");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("does not execute a claimed deep operation when the network delivers it after its deadline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism delayed worker "));
  const marker = join(directory, "executed.txt");
  const cliPath = join(directory, "public cli.mjs");
  await writeFile(
    cliPath,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); console.log('{"ok":true}');`,
  );
  const abort = new AbortController();
  let report: { status: string; result: unknown } | undefined;
  let dispatched = false;
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/worker/next") {
      if (dispatched) {
        response.end('{"job":null}');
        return;
      }
      dispatched = true;
      const job: LocalJob = {
        id: "delayed",
        taskId: "deep",
        status: "claimed",
        createdAt: "now",
        updatedAt: "now",
        deadlineAt: new Date(Date.now() + 10).toISOString(),
        command: {
          approved: true,
          prism: { command: "observe", session: "s", scope: "local" },
        },
      };
      await new Promise((done) => setTimeout(done, 40));
      response.end(JSON.stringify({ job }));
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    report = JSON.parse(chunks.join(""));
    response.end('{"accepted":true}');
    setTimeout(() => abort.abort(), 0);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server missing");
  try {
    await runLocalWorker({
      server: `http://127.0.0.1:${address.port}`,
      token: "worker-test",
      directory,
      browserUrl: "http://127.0.0.1:9222",
      cliPath,
      loggedIn: true,
      signal: abort.signal,
    });
    expect(report).toMatchObject({
      status: "failed",
      result: { error: expect.stringContaining("时间上限") },
    });
    expect(existsSync(marker)).toBe(false);
  } finally {
    abort.abort();
    await new Promise<void>((done) => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});
