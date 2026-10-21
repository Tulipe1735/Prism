import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { z } from "zod";

import { ConfigError } from "../shared/errors.ts";
import { asRecord } from "../shared/records.ts";
import {
  BROWSER_ENGINES,
  type BrowserEngine,
  PERMISSION_SCOPES,
  type PermissionScope,
} from "./types.ts";

export interface ModelConfig {
  /** OpenAI-compatible base URL; request paths are appended to it. */
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface PermissionsConfig {
  /** Boundary in effect at start; the workbench may switch it at runtime. */
  scope: PermissionScope;
}

export interface BrowserConfig {
  engine: BrowserEngine;
  /** When true, every browser action goes through one-time approval (US-30). */
  actionsNeedApproval: boolean;
  /** Chromium only: take over a browser started with `--remote-debugging-port`. */
  endpoint?: string;
}

export interface SearchConfig {
  provider: string;
  apiKey?: string;
  /** Overrides the source endpoint; defaults to the provider's own. */
  baseUrl?: string;
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
  permissions: PermissionsConfig;
  creator: { enabled: boolean };
}

export interface PrismConfigOverrides {
  model?: Partial<ModelConfig>;
  browser?: Partial<BrowserConfig>;
  search?: Partial<SearchConfig>;
  compaction?: Partial<CompactionConfig>;
  command?: Partial<CommandConfig>;
}

/** Settings a running kernel may change; other sections stay as they are. */
export interface ConfigPatch {
  model?: Partial<ModelConfig>;
  /** `endpoint` is start-time only: it decides how the engine is taken over. */
  browser?: Partial<Pick<BrowserConfig, "engine" | "actionsNeedApproval">>;
  search?: Partial<Pick<SearchConfig, "provider" | "baseUrl">>;
  permissions?: { scope?: PermissionScope };
  creator?: { enabled: boolean };
}

const DEFAULTS = {
  model: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  browser: { engine: "chromium", actionsNeedApproval: false },
  search: { provider: "deepseek" },
  compaction: { triggerTokens: 100_000, keepTokens: 15_000 },
  command: { timeoutMs: 120_000 },
  permissions: { scope: "workspace-write" },
  creator: { enabled: false },
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
      .object({
        engine: z.enum(BROWSER_ENGINES),
        actionsNeedApproval: z.boolean(),
        endpoint: z.string().min(1),
      })
      .partial()
      .strict()
      .optional(),
    search: z
      .object({
        provider: z.string().min(1),
        apiKey: z.string().min(1),
        baseUrl: z.string().min(1),
      })
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
    permissions: z
      .object({ scope: z.enum(PERMISSION_SCOPES) })
      .partial()
      .strict()
      .optional(),
    creator: z.object({ enabled: z.boolean() }).strict().optional(),
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
    permissions: { ...DEFAULTS.permissions, ...file.permissions },
    creator: { ...DEFAULTS.creator, ...file.creator },
  };
}

/**
 * Merges settings into `<dataDir>/config.json` so the next kernel start reads
 * them back; every other section stays as it is.
 */
export async function saveConfigPatch(
  dataDir: string,
  patch: ConfigPatch,
): Promise<void> {
  const path = configPath(dataDir);
  const existing = await readRawConfig(path);
  const merged: Record<string, unknown> = { ...existing };
  if (patch.model !== undefined)
    merged.model = { ...asRecord(existing.model), ...patch.model };
  if (patch.browser !== undefined)
    merged.browser = { ...asRecord(existing.browser), ...patch.browser };
  if (patch.search !== undefined)
    merged.search = { ...asRecord(existing.search), ...patch.search };
  if (patch.permissions !== undefined)
    merged.permissions = { ...asRecord(existing.permissions), ...patch.permissions };
  if (patch.creator !== undefined)
    merged.creator = { ...asRecord(existing.creator), ...patch.creator };
  const result = configFileSchema.safeParse(merged);
  if (!result.success)
    throw new ConfigError(`${path} is invalid: ${result.error.message}`);
  await mkdir(dataDir, { recursive: true });
  await writeFile(path, `${JSON.stringify(result.data, null, 2)}\n`, "utf8");
}

async function readConfigFile(path: string): Promise<ConfigFile> {
  const parsed = await readRawConfig(path);
  const result = configFileSchema.safeParse(parsed);
  if (!result.success)
    throw new ConfigError(`${path} is invalid: ${result.error.message}`);
  return result.data;
}

async function readRawConfig(path: string): Promise<Record<string, unknown>> {
  const text = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return {};
  try {
    return asRecord(JSON.parse(text)) ?? {};
  } catch (error) {
    throw new ConfigError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
}
