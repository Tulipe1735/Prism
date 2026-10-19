import type { DesktopSetupChoice, DesktopSetupState } from "./desktop-contract.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClerkBridge } from "@clerk/electron";
import { storage } from "@clerk/electron/storage";
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { NsisUpdater } from "electron-updater";
import { BROWSER_ENGINES, type BrowserEngine } from "../../kernel/types.ts";
import { VERSION } from "../../shared/version.ts";
import {
  type KernelLaunchOptions,
  launchKernel,
  type RunningKernelProcess,
} from "../kernel-process.ts";
import { type RunningUiServer, startUiServer } from "../ui-server.ts";
import {
  installWslBrowser,
  listDistributions,
  prepareWslRuntime,
} from "../wsl-runtime.ts";
import { RENDERER_HOST, RENDERER_ORIGIN, RENDERER_SCHEME } from "./identity-config.ts";
import { isRendererUrl, registerRenderer } from "./renderer.ts";
import { createDesktopUpdates } from "./updates.ts";

let kernel: RunningKernelProcess | null = null;
let ui: RunningUiServer | null = null;
let window: BrowserWindow | null = null;
let stopping = false;
let preparing = false;
let runtime: KernelLaunchOptions | null = null;
let installingBrowser = false;
const preparation = new AbortController();
let setup: DesktopSetupState = {
  phase: "checking",
  distributions: [],
  selected: "",
  message: "正在检查运行环境…",
  detail: "",
};

app.setName("Prism");
app.setAppUserModelId("io.github.tulipe1735.prism");
const ownsInstance = app.requestSingleInstanceLock();
const clerk = ownsInstance
  ? createClerkBridge({
      storage: storage(),
      renderer: { scheme: RENDERER_SCHEME, host: RENDERER_HOST },
      manageSingleInstanceLock: false,
    })
  : null;
if (!ownsInstance) app.quit();
else void main().catch(fail);

async function main(): Promise<void> {
  await app.whenReady();
  registerRenderer(() => ui?.url);
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#f8f8f5",
    title: `Prism ${app.getVersion()}`,
    icon: join(uiRoot(), "assets/prism-icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: join(appRoot(), "dist/workbench/electron/preload.cjs"),
    },
  });
  window.on("closed", () => {
    window = null;
    app.quit();
  });
  const startupUrl = pathToFileURL(join(uiRoot(), "startup.html")).href;
  const trustedNavigation = (url: string): boolean =>
    isRendererUrl(url) || url === startupUrl;
  window.webContents.on("will-navigate", (event, url) => {
    if (trustedNavigation(url)) return;
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://"))
      void shell.openExternal(url);
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (event.isMainFrame && !trustedNavigation(url)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://"))
      void shell.openExternal(url);
    return { action: "deny" };
  });
  const updates = createDesktopUpdates({
    updater: app.isPackaged && process.platform === "win32" ? new NsisUpdater() : null,
    version: app.isPackaged ? app.getVersion() : VERSION,
    publish: (state) => {
      if (window !== null && !window.isDestroyed())
        window.webContents.send("prism:updates:state", state);
    },
  });
  const requireWorkbench = (event: Electron.IpcMainInvokeEvent): void => {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !isRendererUrl(event.senderFrame.url)
    )
      throw new Error("此操作只能在 Prism 工作台中执行。");
  };
  ipcMain.handle("prism:updates:read", (event) => {
    requireWorkbench(event);
    return updates.read();
  });
  ipcMain.handle("prism:updates:check", (event) => {
    requireWorkbench(event);
    return updates.check();
  });
  ipcMain.handle("prism:updates:download", (event) => {
    requireWorkbench(event);
    return updates.download();
  });
  ipcMain.handle("prism:updates:install", async (event) => {
    requireWorkbench(event);
    if (kernel === null) throw new Error("请等待内核启动完成。");
    const status = (await fetch(`${kernel.url}/status`).then((response) =>
      response.json(),
    )) as { runningTasks: number };
    if (status.runningTasks !== 0)
      throw new Error("还有任务正在运行，请等待完成后再安装更新。");
    updates.install();
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "工作台",
        submenu: [
          { role: "reload", label: "重新加载界面" },
          { type: "separator" },
          { role: "quit", label: "退出 Prism" },
        ],
      },
      {
        label: "运行环境",
        submenu: BROWSER_ENGINES.map((engine) => ({
          label: `准备 ${engine} 浏览器…`,
          enabled: process.platform === "win32",
          click: () => {
            void installBrowser(engine);
          },
        })),
      },
    ]),
  );
  ipcMain.handle("prism:setup:read", () => setup);
  ipcMain.handle("prism:setup:wsl-guide", () =>
    shell.openExternal("https://learn.microsoft.com/zh-cn/windows/wsl/install"),
  );
  ipcMain.handle("prism:setup:prepare", (event, choice: DesktopSetupChoice) => {
    if (event.sender !== window?.webContents || preparing || kernel !== null) return;
    if (setup.distributions.length === 0) {
      void initialize().catch(fail);
      return;
    }
    if (
      typeof choice?.distribution !== "string" ||
      !setup.distributions.includes(choice.distribution) ||
      typeof choice.installBrowser !== "boolean"
    )
      throw new Error("请选择列表中的 WSL 发行版。");
    void prepare(choice).catch(fail);
  });
  await window.loadFile(join(uiRoot(), "startup.html"));
  if (process.platform === "win32") await initialize();
  else {
    update({ phase: "starting", message: "正在启动内核…" });
    // Electron's executable becomes a Node runtime for the development kernel.
    kernel = await launchKernel({
      projectRoot: appRoot(),
      node: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    await openWorkbench();
  }
}

async function initialize(): Promise<void> {
  update({ phase: "checking", message: "正在检查 WSL 发行版…", detail: "" });
  const distributions = await listDistributions();
  const preferences = await readPreferences();
  update({
    phase: "choose",
    distributions,
    selected: distributions.includes(preferences?.distribution ?? "")
      ? preferences!.distribution
      : (distributions[0] ?? ""),
    message:
      distributions.length === 0 ? "需要先准备 WSL 环境" : "选择 Prism 的工作环境",
  });
  if (preferences !== null && distributions.includes(preferences.distribution))
    await prepare(preferences);
}

async function prepare(choice: DesktopSetupChoice): Promise<void> {
  if (preparing || stopping) return;
  preparing = true;
  update({
    phase: "preparing",
    selected: choice.distribution,
    message: "正在准备内核运行环境…",
    detail: "",
  });
  try {
    const options = await prepareWslRuntime({
      resources: app.isPackaged
        ? process.resourcesPath
        : join(appRoot(), ".packaging/resources"),
      distribution: choice.distribution,
      installBrowser: choice.installBrowser,
      ...(process.env.PRISM_DATA_DIR === undefined
        ? {}
        : { dataDir: process.env.PRISM_DATA_DIR }),
      onProgress: (text) => update({ detail: (setup.detail + text).slice(-8000) }),
      signal: preparation.signal,
    });
    runtime = options;
    if (stopping) return;
    update({ phase: "starting", message: "正在启动内核…" });
    kernel = await launchKernel(options);
    if (stopping) {
      await kernel.close();
      return;
    }
    await mkdir(app.getPath("userData"), { recursive: true });
    await writeFile(preferencesFile(), `${JSON.stringify(choice, null, 2)}\n`);
    await openWorkbench();
  } catch (error) {
    await ui?.close();
    ui = null;
    await kernel?.close();
    kernel = null;
    throw error;
  } finally {
    preparing = false;
  }
}

async function installBrowser(engine: BrowserEngine): Promise<void> {
  if (window === null || installingBrowser) return;
  if (runtime === null) {
    await dialog.showMessageBox(window, {
      type: "info",
      message: "请先完成 WSL 运行环境准备。",
    });
    return;
  }
  installingBrowser = true;
  window.setProgressBar(2);
  window.setTitle(`Prism · 正在准备 ${engine} 浏览器…`);
  try {
    await installWslBrowser(runtime, engine);
    if (window !== null)
      await dialog.showMessageBox(window, {
        type: "info",
        message: `${engine} 浏览器已准备好。`,
        detail: "可在工作台设置中选择该浏览器引擎。",
      });
  } catch (error) {
    if (window !== null)
      await dialog.showMessageBox(window, {
        type: "error",
        message: "浏览器准备失败",
        detail: String(error),
      });
  } finally {
    installingBrowser = false;
    window?.setProgressBar(-1);
    window?.setTitle(`Prism ${app.getVersion()}`);
  }
}

async function openWorkbench(): Promise<void> {
  if (kernel === null || window === null || stopping) return;
  ui = await startUiServer({ kernelUrl: kernel.url, uiRoot: uiRoot() });
  const settings = (await fetch(`${kernel.url}/settings`).then((response) =>
    response.json(),
  )) as { model: { hasApiKey: boolean } };
  await window.loadURL(
    `${RENDERER_ORIGIN}/${settings.model.hasApiKey ? "" : "?setup=model"}`,
  );
  process.stdout.write(
    `${JSON.stringify({ type: "workbench.window", url: ui.url, rendererUrl: RENDERER_ORIGIN, port: ui.port, kernelUrl: kernel.url })}\n`,
  );
}

function appRoot(): string {
  return app.isPackaged
    ? app.getAppPath()
    : fileURLToPath(new URL("../../../", import.meta.url));
}

function uiRoot(): string {
  return join(appRoot(), "dist/workbench-ui");
}
function preferencesFile(): string {
  return join(app.getPath("userData"), "desktop.json");
}

async function readPreferences(): Promise<DesktopSetupChoice | null> {
  try {
    const value: unknown = JSON.parse(await readFile(preferencesFile(), "utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "distribution" in value &&
      typeof value.distribution === "string" &&
      "installBrowser" in value &&
      typeof value.installBrowser === "boolean"
    )
      return { distribution: value.distribution, installBrowser: value.installBrowser };
  } catch {
    /* First start or invalid preferences: ask the user to choose again. */
  }
  return null;
}

function update(patch: Partial<DesktopSetupState>): void {
  setup = { ...setup, ...patch };
  if (window !== null && !window.isDestroyed())
    window.webContents.send("prism:setup:state", setup);
}

function fail(error: unknown): void {
  if (stopping) return;
  const detail =
    error instanceof Error && "output" in error ? String(error.output) : "";
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Workbench failed to start: ${message}\n${detail}\n`);
  if (window !== null && !window.isDestroyed())
    update({
      phase: "error",
      message: "运行环境准备失败",
      detail: `${message}\n${detail}`.trim(),
    });
  else {
    dialog.showErrorBox("Prism", message);
    app.exit(1);
  }
}

app.on("second-instance", () => {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});
app.on("before-quit", (event) => {
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  clerk?.cleanup();
  preparation.abort();
  void (async () => {
    await ui?.close();
    await kernel?.close();
    app.exit(0);
  })();
});
app.on("window-all-closed", () => app.quit());
