import type { BrowserEngine } from "../kernel/types.ts";
import type { KernelLaunchOptions } from "./kernel-process.ts";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";

export interface RuntimeManifest {
  version: string;
  nodeVersion: string;
  arch: "x64";
  sha256: string;
}

export function parseDistributions(output: Buffer): string[] {
  return output
    .toString("utf16le")
    .replaceAll("\uFEFF", "")
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter((name) => name !== "" && !name.startsWith("docker-desktop"));
}

export async function listDistributions(): Promise<string[]> {
  return parseDistributions(await run("wsl.exe", ["--list", "--quiet"]));
}

/** Arguments stay separate from shell code, including Windows paths and distro names. */
export const PREPARE_RUNTIME_SCRIPT = `set -eu
payload=$(wslpath -u "$1")
runtime_id=$2
install_browser=$3
data_override=$4
if [ "$(uname -m)" != x86_64 ]; then
  echo 'This installer needs an x86_64 WSL distribution.' >&2
  exit 1
fi
runtime_base="\${XDG_DATA_HOME:-$HOME/.local/share}/prism/runtime"
runtime="$runtime_base/$runtime_id"
if [ ! -f "$runtime/.ready" ]; then
  echo '正在展开内核与 Node 运行时…'
  mkdir -p "$runtime_base"
  staging="$runtime.partial.$$"
  trap 'rm -rf "$staging"' EXIT
  mkdir -p "$staging"
  tar -xzf "$payload" -C "$staging"
  chmod +x "$staging/node/bin/node"
  "$staging/node/bin/node" --version
  "$staging/node/bin/node" "$staging/kernel.cjs" --help >/dev/null
  touch "$staging/.ready"
  if [ -d "$runtime" ]; then rm -rf "$runtime"; fi
  mv "$staging" "$runtime"
  trap - EXIT
fi
export PATH="$runtime/node/bin:$PATH"
if [ "$install_browser" = 1 ]; then
  echo '正在准备 Chromium 浏览器（首次准备可能需要下载）…'
  "$runtime/node/bin/node" "$runtime/node_modules/playwright/cli.js" install chromium
fi
"$runtime/node/bin/node" -e '
const path = require("node:path");
const os = require("node:os");
const root = process.argv[1];
const dataDir = process.argv[2] || path.join(os.homedir(), ".prism");
if (!path.isAbsolute(dataDir)) throw new Error("PRISM_DATA_DIR must be an absolute WSL path");
console.log("PRISM_RUNTIME_READY=" + JSON.stringify({ node: process.execPath, entry: { path: path.join(root, "kernel.cjs"), flags: [] }, dataDir }));
' "$runtime" "$data_override"
`;

export async function prepareWslRuntime(options: {
  resources: string;
  distribution: string;
  installBrowser: boolean;
  dataDir?: string;
  onProgress: (text: string) => void;
  signal?: AbortSignal;
}): Promise<KernelLaunchOptions> {
  const directory = join(options.resources, "runtime");
  const manifest: RuntimeManifest = JSON.parse(
    await readFile(join(directory, "manifest.json"), "utf8"),
  );
  if (
    !/^[\da-f]{64}$/.test(manifest.sha256) ||
    !/^[\w.-]+$/.test(manifest.version) ||
    manifest.arch !== "x64"
  )
    throw new Error("安装包的内核运行时清单无效，请重新下载安装包。");
  const payload = join(directory, "prism-kernel.tar.gz");
  const checksum = createHash("sha256")
    .update(await readFile(payload))
    .digest("hex");
  if (checksum !== manifest.sha256)
    throw new Error("内核运行时校验失败，请重新下载安装包。");
  const output = await run(
    "wsl.exe",
    [
      "--distribution",
      options.distribution,
      "--exec",
      "sh",
      "-s",
      "--",
      payload,
      `${manifest.version}-${checksum.slice(0, 12)}`,
      options.installBrowser ? "1" : "0",
      options.dataDir ?? "",
    ],
    {
      input: PREPARE_RUNTIME_SCRIPT,
      onProgress: options.onProgress,
      timeout: 15 * 60_000,
      signal: options.signal,
    },
  );
  const ready = output
    .toString("utf8")
    .split(/\r?\n/)
    .find((line) => line.startsWith("PRISM_RUNTIME_READY="));
  if (ready === undefined)
    throw new Error("WSL 没有返回内核准备结果。请查看上方日志后重试。");
  const prepared: {
    node: string;
    entry: { path: string; flags: string[] };
    dataDir: string;
  } = JSON.parse(ready.slice("PRISM_RUNTIME_READY=".length));
  return { ...prepared, distribution: options.distribution, platform: "win32" };
}

export async function installWslBrowser(
  runtime: KernelLaunchOptions,
  engine: BrowserEngine,
): Promise<void> {
  if (
    runtime.node === undefined ||
    runtime.entry === undefined ||
    runtime.distribution === undefined
  )
    throw new Error("请先完成 WSL 运行环境准备。");
  await run(
    "wsl.exe",
    [
      "--distribution",
      runtime.distribution,
      "--exec",
      runtime.node,
      posix.join(posix.dirname(runtime.entry.path), "node_modules/playwright/cli.js"),
      "install",
      engine,
    ],
    { timeout: 15 * 60_000 },
  );
}

function run(
  command: string,
  args: string[],
  options: {
    input?: string;
    onProgress?: (text: string) => void;
    timeout?: number;
    signal?: AbortSignal;
  } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      signal: options.signal,
    });
    const stdout: Buffer[] = [];
    let detail = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("准备 WSL 运行环境超时，请检查 WSL 与网络后重试。"));
    }, options.timeout ?? 30_000);
    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error);
      else resolve(Buffer.concat(stdout));
    }
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      options.onProgress?.(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString(chunk.includes(0) ? "utf16le" : "utf8");
      detail = (detail + text).slice(-8000);
      options.onProgress?.(text);
    });
    child.once("error", (error) => finish(new Error(`无法运行 WSL：${error.message}`)));
    child.once("close", (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(detail.trim() || `WSL 命令退出（${code}）。`),
      ),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(options.input);
  });
}
