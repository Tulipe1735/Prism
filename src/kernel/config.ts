import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { z } from "zod";

import { ConfigError } from "../shared/errors.ts";
import { BROWSER_ENGINES, type BrowserEngine } from "./types.ts";

export interface ModelConfig {
  /** OpenAI-compatible base URL; request paths are appended to it. */
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface BrowserConfig {
  engine: BrowserEngine;
}

export interface SearchConfig {
  provider: string;
  apiKey?: string;
}

export interface CompactionConfig {
  /** Estimated context tokens that trigger automatic compaction. */
  triggerTokens: number;
  /** Newest history kept verbatim after a compaction, in estimated tokens. */
  keepTokens: number;
}

export interface CommandConfig {
  /** Wall-clock limit for one command; the tool may override it per call. */
  timeoutMs: number;
}

export interface PrismConfig {
  /** Directory holding sessions, receipts and the config file itself. */
  dataDir: string;
  model: ModelConfig;
  browser: BrowserConfig;
  search: SearchConfig;
  compaction: CompactionConfig;
  command: CommandConfig;
}

export interface PrismConfigOverrides {
  model?: Partial<ModelConfig>;
  browser?: Partial<BrowserConfig>;
  search?: Partial<SearchConfig>;
  compaction?: Partial<CompactionConfig>;
  command?: Partial<CommandConfig>;
}

const DEFAULTS = {
  model: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  browser: { engine: "chromium" },
  search: { provider: "deepseek" },
  compaction: { triggerTokens: 100_000, keepTokens: 15_000 },
  command: { timeoutMs: 120_000 },
} as const;

const configFileSchema = z
  .object({
    model: z
      .object({
        baseUrl: z.string().min(1),
        model: z.string().min(1),
        apiKey: z.string().min(1),
      })
      .partial()
      .strict()
      .optional(),
    browser: z
      .object({ engine: z.enum(BROWSER_ENGINES) })
      .partial()
      .strict()
      .optional(),
    search: z
      .object({ provider: z.string().min(1), apiKey: z.string().min(1) })
      .partial()
      .strict()
      .optional(),
    compaction: z
      .object({
        triggerTokens: z.number().int().positive(),
        keepTokens: z.number().int().positive(),
      })
      .partial()
      .strict()
      .optional(),
    command: z
      .object({ timeoutMs: z.number().int().positive() })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

type ConfigFile = z.infer<typeof configFileSchema>;

export function configPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

/** Data directory from the explicit argument, `PRISM_DATA_DIR`, or `~/.prism`. */
export function resolveDataDir(option?: string): string {
  const value = option ?? process.env.PRISM_DATA_DIR;
  return value === undefined || value === ""
    ? join(homedir(), ".prism")
    : resolve(value);
}

/** Defaults, overridden by `<dataDir>/config.json`, overridden by explicit values. */
export async function loadConfig(
  options: { dataDir?: string; overrides?: PrismConfigOverrides } = {},
): Promise<PrismConfig> {
  const dataDir = resolveDataDir(options.dataDir);
  const file = await readConfigFile(configPath(dataDir));
  return {
    dataDir,
    model: { ...DEFAULTS.model, ...file.model, ...options.overrides?.model },
    browser: { ...DEFAULTS.browser, ...file.browser, ...options.overrides?.browser },
    search: { ...DEFAULTS.search, ...file.search, ...options.overrides?.search },
    compaction: {
      ...DEFAULTS.compaction,
      ...file.compaction,
      ...options.overrides?.compaction,
    },
    command: { ...DEFAULTS.command, ...file.command, ...options.overrides?.command },
  };
}

async function readConfigFile(path: string): Promise<ConfigFile> {
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const result = configFileSchema.safeParse(parsed);
  if (!result.success)
    throw new ConfigError(`${path} is invalid: ${result.error.message}`);
  return result.data;
}
