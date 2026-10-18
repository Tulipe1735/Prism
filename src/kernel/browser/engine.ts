import type { Browser, BrowserContext } from "playwright";

import { chromium, firefox, webkit } from "playwright";
import { ConfigError } from "../../shared/errors.ts";

/** Engine names follow the Playwright browser types; Chromium is the default. */
export const BROWSER_ENGINES = ["chromium", "firefox", "webkit"] as const;
export type BrowserEngineName = (typeof BROWSER_ENGINES)[number];

const TYPES = { chromium, firefox, webkit } as const;
const VIEWPORT = { width: 1120, height: 780 } as const;

export interface EngineOptions {
  engine?: BrowserEngineName;
  /** Chromium only: take over a running Chrome/Edge over CDP. */
  endpoint?: string;
  headless?: boolean;
}

export interface EngineHandle {
  name: BrowserEngineName;
  browser: Browser;
  context: BrowserContext;
  close: () => Promise<void>;
}

/** Playwright manages engine builds; this reports the command that installs one. */
export function engineInstallCommand(name: BrowserEngineName): string {
  return `npx playwright install ${name}`;
}

export async function openEngine(options: EngineOptions = {}): Promise<EngineHandle> {
  const name = options.engine ?? "chromium";
  const type = TYPES[name];
  if (!type)
    throw new ConfigError(
      `Unknown browser engine "${name}". Use ${BROWSER_ENGINES.join(", ")}.`,
    );
  if (options.endpoint !== undefined) {
    if (name !== "chromium")
      throw new ConfigError(
        `Only Chromium can take over a running browser with connectOverCDP, not ${name}.`,
      );
    return takeOver(options.endpoint);
  }
  let browser: Browser;
  try {
    browser = await type.launch({ headless: options.headless ?? true });
  } catch (error) {
    throw launchProblem(name, error);
  }
  const context = await browser.newContext({ viewport: VIEWPORT });
  return { name, browser, context, close: () => browser.close() };
}

/**
 * A CDP-connected browser belongs to the user: close() detaches Playwright
 * instead of closing the browser, and the owned tab is closed by the session.
 */
async function takeOver(endpoint: string): Promise<EngineHandle> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint);
  } catch (error) {
    throw new ConfigError(
      `Could not take over the browser at ${endpoint}. ${message(error)} ` +
        "Start Chrome or Edge with --remote-debugging-port=<port>, then retry.",
    );
  }
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new ConfigError(
      `The browser at ${endpoint} exposes no default context to take over.`,
    );
  }
  return { name: "chromium", browser, context, close: () => browser.close() };
}

/** Turn missing builds and missing system libraries into actionable errors. */
function launchProblem(name: BrowserEngineName, error: unknown): Error {
  const detail = message(error);
  if (detail.includes("Executable doesn't exist"))
    return new ConfigError(
      `The ${name} browser build is not installed. Run: ${engineInstallCommand(name)}`,
    );
  if (detail.includes("missing dependencies"))
    return new ConfigError(
      `The ${name} browser is missing system libraries. Run: npx playwright install --with-deps ${name}`,
    );
  return error instanceof Error ? error : new Error(detail);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
