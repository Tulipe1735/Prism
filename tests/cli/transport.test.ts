import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sendCommand, socketPath } from "../../src/cli/transport.ts";

it("treats a lost or malformed act acknowledgement as unknown without retrying", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism-transport-"));
  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    request.resume();
    response.end("incomplete acknowledgement");
  });
  try {
    await new Promise<void>((resolve) => server.listen(socketPath(directory), resolve));
    await expect(
      sendCommand(directory, {
        command: "act",
        session: "s1",
        observation: "o1",
        target: "o1:e1",
        evidence: "v1",
        operation: "click",
        request_id: "r1",
      }),
    ).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
      nextCommand: "prism receipt --session s1 --request-id r1",
    });
    expect(requests).toBe(1);
  } finally {
    const closing = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections();
    await closing;
    await rm(directory, { recursive: true, force: true });
  }
});
