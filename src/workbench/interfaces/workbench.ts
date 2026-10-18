#!/usr/bin/env node
import process from "node:process";
import { parseArgs } from "node:util";
import { VERSION } from "../../shared/version.ts";
import { launchKernel, type RunningKernelProcess } from "../kernel-process.ts";
import { startUiServer } from "../ui-server.ts";

const HELP = `Prism workbench ${VERSION} — local Web UI for the kernel, over HTTP and SSE

Usage: workbench [--kernel <url>] [options]

  --kernel <url>       Use a kernel that is already running; without it the
                       workbench starts one from this checkout.
  --project-root <dir> Checkout the kernel entry is resolved in; defaults to
                       the current directory.
  --data-dir <path>    Data directory for a kernel this command starts.
  --port <n>           Port of the UI server; 0 (default) picks a free one.
  --ui-root <dir>      Directory holding index.html, app.js and app.css;
                       defaults to the directory of this script.

The workbench prints one JSON line when the UI is listening, then serves the
workbench. Open the printed URL in a browser, or let the Electron shell open
it; the kernel is reached through /kernel on the same origin.
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      kernel: { type: "string" },
      "project-root": { type: "string" },
      "data-dir": { type: "string" },
      port: { type: "string" },
      "ui-root": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help === true) {
    process.stdout.write(HELP);
    return;
  }

  const projectRoot = values["project-root"] ?? process.cwd();
  let kernel: RunningKernelProcess | null = null;
  let kernelUrl = values.kernel;
  if (kernelUrl === undefined) {
    kernel = await launchKernel({
      projectRoot,
      ...(values["data-dir"] === undefined ? {} : { dataDir: values["data-dir"] }),
    });
    kernelUrl = kernel.url;
    process.stderr.write(
      `Kernel ${kernel.version} ready at ${kernel.url} (data ${kernel.dataDir})\n`,
    );
  }

  const ui = await startUiServer({
    kernelUrl,
    ...(values["ui-root"] === undefined ? {} : { uiRoot: values["ui-root"] }),
    ...(values.port === undefined ? {} : { port: parsePort(values.port) }),
  });
  process.stdout.write(
    `${JSON.stringify({
      type: "workbench.ready",
      url: ui.url,
      port: ui.port,
      kernelUrl,
    })}\n`,
  );
  process.stderr.write(`Workbench UI: ${ui.url} (kernel ${kernelUrl})\n`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await ui.close();
      await kernel?.close();
      process.exit(0);
    })();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error(`--port must be an integer between 0 and 65535, received ${value}`);
  return port;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
