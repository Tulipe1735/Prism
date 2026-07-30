import { z } from "zod";

export const REPAIR_REQUEST_SCHEMA_VERSION = "prism.repair-request/v1" as const;
export const REPAIR_REQUEST_VALIDATION_SCHEMA_VERSION =
  "prism.repair-request-validation/v1" as const;
export const CONTRACT_ERROR_SCHEMA_VERSION = "prism.contract-error/v1" as const;

const absoluteWorkspacePathPattern = /^(?:[A-Za-z]:[\\/]|\/)/;

function hasUnsupportedControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    const isAllowedWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;

    if (
      codePoint !== undefined &&
      ((codePoint < 32 && !isAllowedWhitespace) || codePoint === 127)
    ) {
      return true;
    }
  }

  return false;
}

export const localWorkspaceSchema = z
  .object({
    kind: z.literal("local", {
      error: "Only a local workspace is supported in Prism v1.",
    }),
    path: z
      .string()
      .min(1, "Choose a workspace.")
      .max(1024, "The workspace path is too long.")
      .refine(
        (value) => absoluteWorkspacePathPattern.test(value),
        "Use an absolute Windows or POSIX workspace path.",
      )
      .refine(
        (value) => !value.includes("\u0000"),
        "The workspace path contains an unsupported character.",
      ),
    displayName: z
      .string()
      .trim()
      .min(1, "Give the workspace a display name.")
      .max(120, "The workspace display name is too long."),
  })
  .strict();

export const viewportSchema = z
  .object({
    width: z
      .number()
      .int("Viewport width must be a whole number.")
      .min(320, "Viewport width must be at least 320 px.")
      .max(3840, "Viewport width must be at most 3840 px."),
    height: z
      .number()
      .int("Viewport height must be a whole number.")
      .min(320, "Viewport height must be at least 320 px.")
      .max(2160, "Viewport height must be at most 2160 px."),
    deviceScaleFactor: z
      .number()
      .min(1, "Device scale factor must be at least 1.")
      .max(3, "Device scale factor must be at most 3."),
  })
  .strict();

export const repairRequestSchema = z
  .object({
    schemaVersion: z.literal(REPAIR_REQUEST_SCHEMA_VERSION, {
      error: "This repair request schema version is not supported.",
    }),
    prompt: z
      .string()
      .max(2000, "Keep the repair request under 2,000 characters.")
      .refine(
        (value) => value.trim().length >= 12,
        "Describe one visible frontend problem in at least 12 characters.",
      )
      .refine(
        (value) => !hasUnsupportedControlCharacter(value),
        "The repair request contains an unsupported control character.",
      ),
    workspace: localWorkspaceSchema,
    viewport: viewportSchema,
  })
  .strict();

export const validationIssueSchema = z
  .object({
    path: z.string().min(1),
    code: z.string().min(1),
    message: z.string().min(1),
  })
  .strict();

export const contractErrorSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_ERROR_SCHEMA_VERSION),
    code: z.enum([
      "invalid_json",
      "invalid_repair_request",
      "payload_too_large",
      "unsupported_media_type",
      "unsupported_workspace",
    ]),
    message: z.string().min(1),
    issues: z.array(validationIssueSchema),
  })
  .strict();

export const repairRequestValidationSchema = z
  .object({
    schemaVersion: z.literal(REPAIR_REQUEST_VALIDATION_SCHEMA_VERSION),
    status: z.literal("accepted"),
    request: repairRequestSchema,
  })
  .strict();

export type ContractError = z.infer<typeof contractErrorSchema>;
export type LocalWorkspace = z.infer<typeof localWorkspaceSchema>;
export type RepairRequest = z.infer<typeof repairRequestSchema>;
export type RepairRequestValidation = z.infer<typeof repairRequestValidationSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
export type Viewport = z.infer<typeof viewportSchema>;

export function formatContractIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path:
      issue.path.length > 0
        ? issue.path.map((segment) => String(segment)).join(".")
        : "<root>",
    code: issue.code,
    message: issue.message,
  }));
}
