import type { BrowserConnection } from "../../src/browser/connect.ts";
import type { Reply } from "../../src/cli/protocol.ts";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import process from "node:process";
import { html, type Page } from "./design.ts";

export const hash = (bytes: string | Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
export async function evaluate(
  call: (method: string, params?: object) => Promise<any>,
  expression: string,
): Promise<any> {
  const response = await call("Runtime.evaluate", { expression, returnByValue: true });
  if (response.exceptionDetails)
    throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
export async function fixtures(
  pageSet: Page[],
): Promise<{ url: (page: Page) => string; close: () => Promise<void> }> {
  const lookup = new Map(pageSet.map((page) => [`/${page.id}`, page]));
  const server = createServer((request, response) => {
    const page = lookup.get(request.url ?? "");
    response.writeHead(page ? 200 : 404, { "content-type": "text/html;charset=utf-8" });
    response.end(page ? html(page) : "Unknown page");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url: (page: Page) => `${root}/${page.id}`,
    close: async () => {
      const closed = new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
      server.closeAllConnections();
      await closed;
    },
  };
}
export async function invokeCli(
  directory: string,
  args: string[],
  input?: object,
): Promise<Reply> {
  return new Promise((done, reject) => {
    const child = execFile(
      process.execPath,
      [
        "--experimental-strip-types",
        "--disable-warning=ExperimentalWarning",
        resolve("src/interfaces/cli.ts"),
        ...args,
        "--state-dir",
        directory,
      ],
      { timeout: 40_000, maxBuffer: 2_000_000 },
      (error, stdout, stderr) => {
        try {
          done(JSON.parse(stdout.trim()) as Reply);
        } catch {
          reject(new Error(`${error?.message ?? "Bad CLI JSON"}: ${stderr}`));
        }
      },
    );
    if (input !== undefined) child.stdin!.end(JSON.stringify(input));
  });
}
export async function inspectOwnedTab(
  connection: BrowserConnection,
  url: string,
  expression: string,
): Promise<any> {
  const response = await connection.client.send("Target.getTargets");
  const targets = response.targetInfos.filter(
    (item: { url: string }) => item.url === url,
  );
  if (targets.length !== 1)
    throw new Error(`Expected one owned tab, got ${targets.length}`);
  const attached = await connection.client.send("Target.attachToTarget", {
    targetId: targets[0].targetId,
    flatten: true,
  });
  try {
    return await evaluate(
      (method, params) => connection.client.send(method, params, attached.sessionId),
      expression,
    );
  } finally {
    await connection.client.send("Target.detachFromTarget", {
      sessionId: attached.sessionId,
    });
  }
}
export async function methodFiles(
  extra: string[] = [],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files[child] = hash(await readFile(child));
    }
  }
  await visit("src");
  for (const path of [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "skills/prism/SKILL.md",
    "evals/cli-contract-v1/design.ts",
    "evals/cli-contract-v1/runtime.ts",
    "evals/cli-contract-v1/run.ts",
    "evals/cli-contract-v1/analyze.ts",
    "evals/cli-contract-v1/protocol.md",
    ...extra,
  ])
    files[path] = hash(await readFile(path));
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
export async function historicalFiles(): Promise<Record<string, string>> {
  const previous = JSON.parse(
    await readFile("work/browser-cli-v1-2026-10-04/verification.json", "utf8"),
  );
  const files: Record<string, string> = {};
  for (const entry of [
    ...Object.values(previous.historical_evidence.raw_cohorts),
    ...Object.values(previous.historical_evidence.archives),
  ] as { path: string; sha256: string }[]) {
    const actual = hash(await readFile(entry.path));
    if (actual !== entry.sha256)
      throw new Error(`Historical evidence mismatch: ${entry.path}`);
    files[entry.path] = actual;
  }
  for (const path of [
    "work/relation-preparation-2026-10-04/frozen/freeze.json",
    "work/relation-preparation-2026-10-04/frozen/source.tar.gz",
  ])
    files[path] = hash(await readFile(path));
  return files;
}
export async function freeze(
  out: string,
  browser: string,
  extra: string[] = [],
): Promise<{
  files: Record<string, string>;
  historical: Record<string, string>;
  archive: { path: string; sha256: string };
}> {
  await mkdir(out, { recursive: true });
  const files = await methodFiles(extra);
  const historical = await historicalFiles();
  const archive = join(out, "source.tar.gz");
  await writeFile(archive, "", { flag: "wx" });
  execFileSync("tar", ["-czf", resolve(archive), "--", ...Object.keys(files)]);
  const manifest = {
    study: "cli-contract-v1",
    frozen_at: new Date().toISOString(),
    kind: "local pre-execution source freeze, not external preregistration",
    git_revision: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    git_worktree: execFileSync("git", ["status", "--short"], {
      encoding: "utf8",
    }).trim(),
    node: process.version,
    browser,
    files,
    historical,
    archive: { path: archive, sha256: hash(await readFile(archive)) },
  };
  await writeFile(join(out, "freeze.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
  });
  return manifest;
}
