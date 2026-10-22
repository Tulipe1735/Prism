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
import { installNativeBrowser, prepareNativeRuntime } from "../native-runtime.ts";
import { type RunningUiServer, startUiServer } from "../ui-server.ts";
import {
  installWslBrowser,
  listDistributions,
  prepareWslRuntime,
} from "../wsl-runtime.ts";
import { RENDERER_HOST, RENDERER_ORIGIN, RENDERER_SCHEME } from "./identity-config.ts";
import { isRendererUrl, registerRenderer } from "./renderer.ts";
import { createDesktopUpdates } from "./updates.ts";
import { DesktopWebApps } from "./web-apps.ts";
import { selectWorkspaceDirectory } from "./workspace.ts";

let kernel: RunningKernelProcess | null = null;
let ui: RunningUiServer | null = null;
let webApps: DesktopWebApps | null = null;
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
  mode: "native",
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
    backgroundColor: "#ffffff",
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
  ipcMain.handle("prism:workspace:select", (event, currentPath: unknown) => {
    requireWorkbench(event);
    if (typeof currentPath !== "string") throw new Error("工作区路径必须是文本。");
    if (kernel === null) throw new Error("请等待内核启动完成。");
    return selectWorkspaceDirectory(window!, runtime?.distribution, currentPath);
  });
  ipcMain.handle("prism:web-app:open", (event, input: unknown) => {
    requireWorkbench(event);
    if (webApps === null) throw new Error("请等待内核启动完成。");
    return webApps.open(input);
  });
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
        submenu: [
          {
            label: "切换运行环境…",
            click: () => {
              void changeEnvironment().catch(fail);
            },
          },
          { type: "separator" },
          ...BROWSER_ENGINES.map((engine) => ({
            label: `准备 ${engine} 浏览器…`,
            enabled: process.platform === "win32",
            click: () => {
              void installBrowser(engine);
            },
          })),
        ],
      },
    ]),
  );
  ipcMain.handle("prism:setup:read", () => setup);
  ipcMain.handle("prism:setup:wsl-guide", () =>
    shell.openExternal("https://learn.microsoft.com/zh-cn/windows/wsl/install"),
  );
  ipcMain.handle("prism:setup:prepare", (event, choice: DesktopSetupChoice) => {
    if (event.sender !== window?.webContents || preparing || kernel !== null) return;
    if (choice?.mode === "wsl" && choice.distribution === "") {
      void initialize(false).catch(fail);
      return;
    }
    if (
      (choice?.mode !== "native" && choice?.mode !== "wsl") ||
      typeof choice.installBrowser !== "boolean" ||
      (choice.mode === "wsl" && !setup.distributions.includes(choice.distribution))
    )
      throw new Error("请选择可用的运行环境。");
    void prepare(choice).catch(fail);
  });
  await window.loadFile(join(uiRoot(), "startup.html"));
  if (process.platform === "win32") await initialize();
  else {
    update({ phase: "starting", message: "正在启动内核…" });
    runtime = await prepareNativeRuntime({
      projectRoot: appRoot(),
      node: process.execPath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      installBrowser: false,
      onProgress: () => {},
    });
    kernel = await launchKernel(runtime);
    await openWorkbench();
  }
}

async function initialize(autoStart = true): Promise<void> {
  update({ phase: "checking", message: "正在检查运行环境…", detail: "" });
  // WSL is optional. Its absence must never prevent a native Windows launch.
  const distributions = await listDistributions().catch((): string[] => []);
  const preferences = await readPreferences();
  const available =
    preferences?.mode === "native" ||
    (preferences?.mode === "wsl" && distributions.includes(preferences.distribution));
  update({
    phase: "choose",
    distributions,
    mode: preferences?.mode === "wsl" && available ? "wsl" : "native",
    selected:
      preferences?.mode === "wsl" && available
        ? preferences.distribution
        : (distributions[0] ?? ""),
    message: "选择 Prism 的工作环境",
  });
  if (autoStart && preferences !== null && available) await prepare(preferences);
}

async function changeEnvironment(): Promise<void> {
  if (window === null || preparing || stopping || installingBrowser) return;
  if (kernel !== null) {
    const status = (await fetch(`${kernel.url}/status`).then((response) =>
      response.json(),
    )) as { runningTasks: number };
    if (status.runningTasks > 0) {
      await dialog.showMessageBox(window, {
        type: "info",
        message: "请先完成或取消当前任务，再切换运行环境。",
      });
      return;
    }
  }
  webApps?.close();
  webApps = null;
  await ui?.close();
  ui = null;
  await kernel?.close();
  kernel = null;
  runtime = null;
  await window.loadFile(join(uiRoot(), "startup.html"));
  await initialize(false);
}

async function prepare(choice: DesktopSetupChoice): Promise<void> {
  if (preparing || stopping) return;
  preparing = true;
  update({
    phase: "preparing",
    mode: choice.mode,
    selected: choice.mode === "wsl" ? choice.distribution : "",
    message: "正在准备内核运行环境…",
    detail: "",
  });
  try {
    const progress = {
      installBrowser: choice.installBrowser,
      ...(process.env.PRISM_DATA_DIR === undefined
        ? {}
        : { dataDir: process.env.PRISM_DATA_DIR }),
      onProgress: (text: string) =>
        update({ detail: (setup.detail + text).slice(-8000) }),
      signal: preparation.signal,
    };
    const options =
      choice.mode === "wsl"
        ? await prepareWslRuntime({
            resources: app.isPackaged
              ? process.resourcesPath
              : join(appRoot(), ".packaging/resources"),
            distribution: choice.distribution,
            ...progress,
          })
        : await prepareNativeRuntime({
            projectRoot: appRoot(),
            ...(app.isPackaged ? { resources: process.resourcesPath } : {}),
            node: process.execPath,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            ...progress,
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
    webApps?.close();
    webApps = null;
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
      message: "请先准备运行环境。",
    });
    return;
  }
  installingBrowser = true;
  window.setProgressBar(2);
  window.setTitle(`Prism · 正在准备 ${engine} 浏览器…`);
  try {
    if (runtime.distribution === undefined)
      await installNativeBrowser(runtime, engine, { signal: preparation.signal });
    else await installWslBrowser(runtime, engine);
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
  webApps?.close();
  webApps = new DesktopWebApps({
    kernelUrl: kernel.url,
    parent: window,
    preload: join(appRoot(), "dist/workbench/electron/web-app-preload.cjs"),
  });
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
      "mode" in value &&
      "installBrowser" in value &&
      typeof value.installBrowser === "boolean"
    ) {
      if (value.mode === "native")
        return { mode: "native", installBrowser: value.installBrowser };
      if (
        value.mode === "wsl" &&
        "distribution" in value &&
        typeof value.distribution === "string"
      )
        return {
          mode: "wsl",
          distribution: value.distribution,
          installBrowser: value.installBrowser,
        };
    }
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
    webApps?.close();
    webApps = null;
    await ui?.close();
    await kernel?.close();
    app.exit(0);
  })();
});
app.on("window-all-closed", () => app.quit());
