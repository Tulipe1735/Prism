import type { Buffer } from "node:buffer";
import type { BrowserEngine } from "../kernel/types.ts";
import type { KernelLaunchOptions } from "./kernel-process.ts";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { resolveKernelEntry } from "./kernel-process.ts";

/** Packaged kernels live outside app.asar so Playwright can read its own assets. */
export async function prepareNativeRuntime(options: {
  projectRoot: string;
  resources?: string;
  node: string;
  env: NodeJS.ProcessEnv;
  dataDir?: string;
  installBrowser: boolean;
  onProgress: (text: string) => void;
  signal?: AbortSignal;
}): Promise<KernelLaunchOptions> {
  const entry =
    options.resources === undefined
      ? resolveKernelEntry(options.projectRoot)
      : { path: join(options.resources, "runtime/native/kernel.cjs"), flags: [] };
  await access(entry.path);
  const runtime: KernelLaunchOptions = {
    projectRoot: options.projectRoot,
    entry,
    node: options.node,
    env: options.env,
    ...(options.dataDir === undefined ? {} : { dataDir: options.dataDir }),
  };
  if (options.installBrowser) await installNativeBrowser(runtime, "chromium", options);
  return runtime;
}

export async function installNativeBrowser(
  runtime: KernelLaunchOptions,
  engine: BrowserEngine,
  options: { onProgress?: (text: string) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const root = runtime.entry?.path.endsWith("kernel.cjs")
    ? dirname(runtime.entry.path)
    : runtime.projectRoot;
  if (root === undefined) throw new Error("请先准备运行环境。");
  const cli = join(root, "node_modules/playwright/cli.js");
  await access(cli);
  options.onProgress?.(`正在准备 ${engine} 浏览器…\n`);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(runtime.node ?? process.execPath, [cli, "install", engine], {
      env: runtime.env,
      signal: options.signal,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let detail = "";
    const receive = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      detail = (detail + text).slice(-8000);
      options.onProgress?.(text);
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("浏览器准备超时，请检查网络后重试。"));
    }, 15 * 60_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(detail.trim() || `浏览器准备失败（${code}）。`));
    });
  });
}
