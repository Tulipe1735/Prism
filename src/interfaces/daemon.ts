import { Buffer } from "node:buffer";
import { chmod, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import process from "node:process";
import { commandSchema, ContractError, failure } from "../cli/protocol.ts";
import { Sessions } from "../cli/sessions.ts";
import {
  prepareDirectory,
  sendCommand,
  socketPath,
  stateDirectory,
} from "../cli/transport.ts";

async function main(): Promise<void> {
  const directory = stateDirectory(process.argv[2]);
  await prepareDirectory(directory);
  const socket = socketPath(directory);
  const sessions = new Sessions(directory);
  let active = 0;
  let stopping = false;
  let lastRequest = Date.now();
  let idle: ReturnType<typeof setInterval> | undefined;
  const server = createServer(async (request, response) => {
    active += 1;
    lastRequest = Date.now();
    try {
      if (stopping)
        throw new ContractError(
          "BROKER_STOPPING",
          "Broker is stopping. Query durable receipts before opening a new session.",
        );
      if (request.method !== "POST" || request.url !== "/command")
        throw new ContractError("INVALID_ROUTE", "Use POST /command.");
      let body = "";
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 64_000)
          throw new ContractError("REQUEST_TOO_LARGE", "Command exceeds 64 KB.");
      }
      const parsed = commandSchema.safeParse(JSON.parse(body));
      if (!parsed.success)
        throw new ContractError("INVALID_COMMAND", parsed.error.message);
      const command = parsed.data;
      if (command.command === "shutdown") {
        stopping = true;
        await waitForRequests(1);
      }
      const result = await sessions.handle(command);
      response.writeHead(200, { "content-type": "application/json" });
      if (command.command === "shutdown")
        response.once("finish", () => {
          void stop();
        });
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify(failure(error)));
    } finally {
      active -= 1;
      lastRequest = Date.now();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  async function listen(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socket, () => {
        server.off("error", reject);
        resolve();
      });
    });
  }
  try {
    await listen();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    // Concurrent starts must never unlink another live broker's socket.
    try {
      await sendCommand(directory, { command: "ping" });
      return;
    } catch (probeError) {
      if (
        process.platform === "win32" ||
        !(probeError instanceof ContractError) ||
        !/ECONNREFUSED|ENOENT/.test(probeError.message)
      )
        throw probeError;
      await unlink(socket).catch(() => {});
      await listen();
    }
  }
  if (process.platform !== "win32") await chmod(socket, 0o600);

  async function stop(): Promise<void> {
    stopping = true;
    if (idle) clearInterval(idle);
    server.close();
    // Let pending input finish and persist its receipt before closing owned tabs.
    await waitForRequests(0);
    await sessions.closeAll();
  }
  idle = setInterval(() => {
    if (active === 0 && Date.now() - lastRequest > 15 * 60_000) void stop();
  }, 30_000);
  idle.unref();
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });

  async function waitForRequests(limit: number): Promise<void> {
    for (;;) {
      if (active <= limit) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
