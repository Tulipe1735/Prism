import type { LocalJob } from "../../src/assistant/types.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { executePrism } from "../../src/assistant/local.ts";

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
