import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout } from "node:timers/promises";
import { WorkspaceTerminals } from "../../src/kernel/terminal.ts";

async function main(): Promise<void> {
  assert.equal(process.platform, "win32");
  const workspace = await mkdtemp(join(tmpdir(), "Prism 中文终端 "));
  const service = new WorkspaceTerminals();
  try {
    const terminal = await service.open(workspace, 80, 24);
    let output = "";
    service.subscribe(terminal.id, (event) => {
      if (event.type === "data") output += event.data;
    });
    service.write(
      terminal.id,
      "$env:PRISM_TERMINAL_PROBE='原生'; Write-Output ('中文终端:' + $env:PRISM_TERMINAL_PROBE); (Get-Location).Path\r",
    );
    const deadline = Date.now() + 15_000;
    while (!output.includes("中文终端:原生") && Date.now() < deadline)
      await setTimeout(50);
    assert(output.includes("中文终端:原生"), output);
    assert(output.includes(workspace), output);
    service.resize(terminal.id, 100, 30);
    assert.equal((await service.open(workspace, 100, 30)).id, terminal.id);
  } finally {
    await service.close();
    await rm(workspace, { recursive: true, force: true });
  }
  // The parent test also waits for this process to exit, catching leaked ConPTY workers.
  console.log(
    JSON.stringify({
      native: true,
      terminal: true,
      unicode: true,
      persistent: true,
      closed: true,
    }),
  );
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
