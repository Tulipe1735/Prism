import process from "node:process";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog } from "electron";
import { launchKernel, type RunningKernelProcess } from "../kernel-process.ts";
import { type RunningUiServer, startUiServer } from "../ui-server.ts";

let kernel: RunningKernelProcess | null = null;
let ui: RunningUiServer | null = null;
let stopping = false;

/**
 * The Electron shell owns the kernel's lifetime only: it starts the kernel
 * (through `wsl.exe` on Windows, ADR-0001), starts the UI server and opens the
 * window on it. Sessions, chats and approvals happen in the Web UI.
 */
async function main(): Promise<void> {
  await app.whenReady();
  kernel = await launchKernel({ projectRoot: checkoutRoot() });
  ui = await startUiServer({ kernelUrl: kernel.url });

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    backgroundColor: "#12141a",
    title: `Prism ${app.getVersion()}`,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  window.on("closed", () => app.quit());
  await window.loadURL(ui.url);

  // The smoke test and the user read one machine-readable line, like the kernel does.
  process.stdout.write(
    `${JSON.stringify({
      type: "workbench.window",
      url: ui.url,
      port: ui.port,
      kernelUrl: kernel.url,
    })}\n`,
  );
}

/** The checkout the kernel entry is resolved in: three levels above this file. */
function checkoutRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

app.on("before-quit", (event) => {
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  void (async () => {
    await ui?.close();
    await kernel?.close();
    app.exit(0);
  })();
});

app.on("window-all-closed", () => {
  app.quit();
});

void main().catch((error: unknown) => {
  const output =
    error instanceof Error && "output" in error ? String(error.output) : "";
  const message = `${error instanceof Error ? error.message : String(error)}${
    output.trim() === "" ? "" : `\n\n${output.trim()}`
  }`;
  process.stderr.write(`Workbench failed to start: ${message}\n`);
  dialog.showErrorBox("Prism workbench", message);
  app.exit(1);
});
