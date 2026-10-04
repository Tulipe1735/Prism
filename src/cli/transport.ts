import type { Command, Reply } from "./protocol.ts";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { ContractError, replySchema } from "./protocol.ts";

export function stateDirectory(value?: string): string {
  return resolve(
    value ??
      process.env.PRISM_STATE_DIR ??
      join(tmpdir(), `prism-${process.getuid?.() ?? "user"}`),
  );
}
export function socketPath(directory: string): string {
  if (process.platform === "win32") {
    const key = createHash("sha256").update(directory).digest("hex").slice(0, 24);
    return `\\\\.\\pipe\\prism-${key}`;
  }
  const path = join(directory, "broker.sock");
  if (Buffer.byteLength(path) > 100)
    throw new ContractError(
      "STATE_PATH_TOO_LONG",
      "Choose a shorter --state-dir for the local socket.",
    );
  return path;
}
export async function prepareDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await stat(directory);
  if (
    process.platform !== "win32" &&
    ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
  )
    throw new ContractError(
      "STATE_DIRECTORY_PERMISSIONS",
      "Use a private state directory owned by the current user (mode 700).",
    );
}

/** Never retries requests: an interrupted act may already have sent input. */
export function sendCommand(directory: string, command: Command): Promise<Reply> {
  return new Promise((resolveReply, reject) => {
    const rejectTransport = (error: Error): void => {
      const act = command.command === "act";
      reject(
        new ContractError(
          act ? "OUTCOME_UNKNOWN" : "BROKER_UNAVAILABLE",
          `${error.message} ${act ? "Inspect the receipt and page before making a new decision." : "Open a session to start the broker."}`,
          act
            ? `prism receipt --session ${command.session} --request-id ${command.request_id}`
            : undefined,
        ),
      );
    };
    const client = request(
      {
        socketPath: socketPath(directory),
        path: "/command",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 2_000_000)
            client.destroy(new Error("Broker response exceeded the size limit."));
        });
        response.on("error", rejectTransport);
        response.on("end", () => {
          try {
            resolveReply(replySchema.parse(JSON.parse(body)));
          } catch {
            rejectTransport(new Error("Broker reply was incomplete or invalid."));
          }
        });
      },
    );
    client.setTimeout(30_000, () =>
      client.destroy(new Error("Broker request timed out.")),
    );
    client.on("error", rejectTransport);
    client.end(JSON.stringify(command));
  });
}
