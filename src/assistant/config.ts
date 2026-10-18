import { resolve } from "node:path";
import process from "node:process";

export interface AssistantConfig {
  directory: string;
  host: string;
  port: number;
  ownerToken: string;
  workerToken: string;
  budgetCny: number;
  infrastructureCny: number;
  deepseek: {
    apiKey: string;
    model: string;
    baseUrl: string;
    input: number;
    output: number;
    cacheHit: number;
  };
  notionToken?: string;
  gmail?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    query?: string;
  };
  feishu: Array<{
    role: "intelligence" | "qa";
    appId: string;
    appSecret: string;
    chatId: string;
  }>;
  allowedOpenIds: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AssistantConfig {
  const number = (name: string, fallback: number, max: number): number => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isFinite(value) || value < 0 || value > max)
      throw new Error(`${name} 超出允许范围 0–${max}`);
    return value;
  };
  const budgetCny = number("ASSISTANT_BUDGET_CNY", 50, 50);
  const infrastructureCny = number("ASSISTANT_INFRASTRUCTURE_CNY", 0, budgetCny);
  const feishu: AssistantConfig["feishu"] = [];
  for (const role of ["intelligence", "qa"] as const) {
    const prefix = `FEISHU_${role.toUpperCase()}`;
    const appId = env[`${prefix}_APP_ID`];
    const appSecret = env[`${prefix}_APP_SECRET`];
    const chatId = env[`${prefix}_CHAT_ID`];
    if (appId || appSecret || chatId) {
      if (!appId || !appSecret || !chatId)
        throw new Error(`${prefix} 的 APP_ID、APP_SECRET、CHAT_ID 必须一起配置`);
      feishu.push({ role, appId, appSecret, chatId });
    }
  }
  const allowedOpenIds = (env.FEISHU_ALLOWED_OPEN_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (feishu.length && !allowedOpenIds.length)
    throw new Error("飞书接入需要 FEISHU_ALLOWED_OPEN_IDS 白名单");
  const gmailKeys = [
    env.GMAIL_CLIENT_ID,
    env.GMAIL_CLIENT_SECRET,
    env.GMAIL_REFRESH_TOKEN,
  ];
  if (gmailKeys.some(Boolean) && !gmailKeys.every(Boolean))
    throw new Error("Gmail OAuth 的三项配置必须完整");
  const ownerToken = env.ASSISTANT_OWNER_TOKEN ?? "";
  const workerToken = env.ASSISTANT_WORKER_TOKEN ?? "";
  if (ownerToken && workerToken && ownerToken === workerToken)
    throw new Error("所有者和本地工作端必须使用不同令牌");
  return {
    directory: resolve(env.ASSISTANT_DATA_DIR ?? ".prism-assistant"),
    host: env.ASSISTANT_HOST ?? "127.0.0.1",
    port: number("ASSISTANT_PORT", 8787, 65535),
    ownerToken,
    workerToken,
    budgetCny,
    infrastructureCny,
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY ?? "",
      model: env.DEEPSEEK_MODEL ?? "deepseek-flash",
      baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
      input: number("DEEPSEEK_INPUT_CNY_PER_M", 3, 1000),
      output: number("DEEPSEEK_OUTPUT_CNY_PER_M", 12, 1000),
      cacheHit: number("DEEPSEEK_CACHE_CNY_PER_M", 0.2, 1000),
    },
    notionToken: env.NOTION_TOKEN,
    gmail: gmailKeys.every(Boolean)
      ? {
          clientId: gmailKeys[0]!,
          clientSecret: gmailKeys[1]!,
          refreshToken: gmailKeys[2]!,
          query: env.GMAIL_QUERY,
        }
      : undefined,
    feishu,
    allowedOpenIds,
  };
}
