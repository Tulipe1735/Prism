import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w:-]+$/);
const scope = z.enum(["local", "structural", "relations"]);
const session = { session: id };
const observed = { ...session, observation: id };
const target = { ...observed, target: id };
const webUrl = z
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Use an HTTP(S) URL.",
  );
const browserUrl = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
}, "Use a Chrome HTTP endpoint such as http://127.0.0.1:9222, without a path or credentials.");
export const commandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("ping") }).strict(),
  z.object({ command: z.literal("shutdown") }).strict(),
  z
    .object({ command: z.literal("open"), url: webUrl, browser_url: browserUrl })
    .strict(),
  z.object({ command: z.literal("close"), ...session }).strict(),
  z
    .object({
      command: z.literal("observe"),
      ...session,
      scope: scope.default("local"),
    })
    .strict(),
  z.object({ command: z.literal("context"), ...target, scope }).strict(),
  z
    .object({
      command: z.literal("act"),
      ...target,
      evidence: id,
      operation: z.enum(["click", "fill", "select", "scroll", "wait"]),
      value: z.string().max(20_000).optional(),
      request_id: id,
    })
    .strict(),
  z.object({ command: z.literal("receipt"), ...session, request_id: id }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type ActCommand = Extract<Command, { command: "act" }>;
export interface Problem {
  code: string;
  message: string;
  next_command?: string;
}
export class ContractError extends Error {
  readonly code: string;
  readonly nextCommand?: string;
  constructor(code: string, message: string, nextCommand?: string) {
    super(message);
    this.code = code;
    this.nextCommand = nextCommand;
  }
}
export const receiptSchema = z
  .object({
    session: id,
    request_id: id,
    request_hash: z.string(),
    observation: id,
    target: id,
    evidence: id,
    operation: z.enum(["click", "fill", "select", "scroll", "wait"]),
    outcome: z.enum(["not_executed", "executed", "unknown"]),
    stage: z.enum(["validation", "execution", "receipt"]),
    recorded_at: z.string(),
    code: z.string(),
    message: z.string(),
    next_command: z.string(),
  })
  .strict();
export type Receipt = z.infer<typeof receiptSchema>;
export const replySchema = z
  .object({
    schema_version: z.literal(1),
    ok: z.boolean(),
    data: z.unknown().optional(),
    error: z
      .object({
        code: z.string(),
        message: z.string(),
        next_command: z.string().optional(),
      })
      .optional(),
  })
  .strict();
export type Reply = z.infer<typeof replySchema>;
export const success = (data: unknown): Reply => ({
  schema_version: 1,
  ok: true,
  data,
});
export function failure(error: unknown, data?: unknown): Reply {
  const problem =
    error instanceof ContractError
      ? {
          code: error.code,
          message: error.message,
          ...(error.nextCommand ? { next_command: error.nextCommand } : {}),
        }
      : {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unexpected failure.",
        };
  return {
    schema_version: 1,
    ok: false,
    error: problem,
    ...(data === undefined ? {} : { data }),
  };
}
