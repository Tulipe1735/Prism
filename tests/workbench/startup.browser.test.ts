import type {
  DesktopSetupApi,
  DesktopSetupChoice,
  DesktopSetupState,
} from "../../src/workbench/electron/desktop-contract.ts";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type RunningUiServer, startUiServer } from "../../src/workbench/ui-server.ts";

const uiRoot = resolve("dist/workbench-ui");
describe.runIf(
  process.env.PRISM_WORKBENCH_BROWSER === "1" && existsSync(`${uiRoot}/startup.js`),
)("runtime selection in the startup page", () => {
  let browser: Browser;
  let ui: RunningUiServer;
  let page: Page;
  const choices: DesktopSetupChoice[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();
    ui = await startUiServer({ kernelUrl: "http://127.0.0.1:1", uiRoot });
  });
  afterEach(async () => {
    await page?.close();
    choices.length = 0;
  });
  afterAll(async () => {
    await browser?.close();
    await ui?.close();
  });

  async function open(distributions: string[]): Promise<void> {
    page = await browser.newPage();
    await page.exposeFunction("captureChoice", (choice: DesktopSetupChoice) => {
      choices.push(choice);
    });
    const state: DesktopSetupState = {
      phase: "choose",
      mode: "native",
      distributions,
      selected: distributions[0] ?? "",
      message: "选择 Prism 的工作环境",
      detail: "",
    };
    await page.addInitScript((initial) => {
      const scope = globalThis as typeof globalThis & {
        prismSetup: DesktopSetupApi;
        captureChoice: (value: DesktopSetupChoice) => Promise<void>;
      };
      scope.prismSetup = {
        read: async () => initial,
        subscribe: () => () => {},
        prepare: async (choice) => {
          await scope.captureChoice(choice);
        },
        openWslGuide: async () => {},
      };
    }, state);
    await page.goto(`${ui.url}/startup.html`);
    await page.locator("#prepare").waitFor();
  }

  it("starts natively without WSL and lets an unavailable WSL selection return to Windows", async () => {
    await open([]);
    expect(await page.locator("#runtime-mode").inputValue()).toBe("native");
    expect(await page.locator("#prepare").isEnabled()).toBe(true);
    await page.selectOption("#runtime-mode", "wsl");
    expect(await page.locator("#prepare").isDisabled()).toBe(true);
    expect(
      await page.getByText("未找到 WSL 发行版", { exact: false }).isVisible(),
    ).toBe(true);
    await page.selectOption("#runtime-mode", "native");
    await page.getByRole("checkbox").uncheck();
    await page.locator("#prepare").click();
    await expect
      .poll(() => choices)
      .toEqual([{ mode: "native", installBrowser: false }]);
  });

  it("submits the selected WSL distribution", async () => {
    await open(["Ubuntu", "Debian"]);
    await page.selectOption("#runtime-mode", "wsl");
    await page.selectOption("#distribution", "Debian");
    await page.locator("#prepare").click();
    await expect
      .poll(() => choices)
      .toEqual([{ mode: "wsl", distribution: "Debian", installBrowser: true }]);
  });
});
