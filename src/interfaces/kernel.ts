#!/usr/bin/env node
import process from "node:process";
import { parseArgs } from "node:util";

import { loadConfig } from "../kernel/config.ts";
import { startKernel } from "../kernel/server.ts";
import { parsePort } from "../shared/args.ts";
import { VERSION } from "../shared/version.ts";

const HELP = `Prism kernel ${VERSION} — task loop, tools and sessions over local HTTP/SSE

Usage: kernel [--port <n>] [--data-dir <path>]

  --port <n>        Bind this port on 127.0.0.1; 0 (default) picks a free port.
  --data-dir <path> Data directory for sessions and settings; defaults to
                    PRISM_DATA_DIR or ~/.prism.

The kernel prints one JSON line with its URL when it is listening, then serves
the interface described in docs/kernel-contract.md until POST /shutdown.
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: "string" },
      "data-dir": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help === true) {
    process.stdout.write(HELP);
    return;
  }
  const port = parsePort(values.port);
  const config = await loadConfig(
    values["data-dir"] === undefined ? {} : { dataDir: values["data-dir"] },
  );
  const kernel = await startKernel({ config, port });
  process.stdout.write(
    `${JSON.stringify({
      type: "kernel.ready",
      url: kernel.url,
      port: kernel.port,
      version: VERSION,
      dataDir: config.dataDir,
    })}\n`,
  );
  const stop = (): void => {
    void kernel.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
