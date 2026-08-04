import { z } from "zod";

export const REPAIR_REQUEST_SCHEMA_VERSION = "prism.repair-request/v1" as const;
export const REPAIR_REQUEST_VALIDATION_SCHEMA_VERSION =
  "prism.repair-request-validation/v1" as const;
export const CONTRACT_ERROR_SCHEMA_VERSION = "prism.contract-error/v1" as const;
export const ARTIFACT_REF_SCHEMA_VERSION = "prism.artifact-ref/v1" as const;
export const RUN_MANIFEST_SCHEMA_VERSION = "prism.run-manifest/v1" as const;
export const RUN_EVENT_SCHEMA_VERSION = "prism.run-event/v1" as const;
export const RUN_SNAPSHOT_SCHEMA_VERSION = "prism.run-snapshot/v1" as const;
export const RUN_CREATION_SCHEMA_VERSION = "prism.run-creation/v1" as const;
export const RUN_LIST_SCHEMA_VERSION = "prism.run-list/v1" as const;
export const RUN_DOSSIER_RESPONSE_SCHEMA_VERSION =
  "prism.run-dossier-response/v1" as const;
export const WORKSPACE_REQUEST_SCHEMA_VERSION = "prism.workspace-request/v1" as const;
export const WORKSPACE_EVIDENCE_SCHEMA_VERSION = "prism.workspace-evidence/v1" as const;
export const WORKSPACE_EVIDENCE_RESPONSE_SCHEMA_VERSION =
  "prism.workspace-evidence-response/v1" as const;
export const BROWSER_BASELINE_REQUEST_SCHEMA_VERSION =
  "prism.browser-baseline-request/v1" as const;
export const BROWSER_BASELINE_SCHEMA_VERSION = "prism.browser-baseline/v1" as const;
export const BROWSER_BASELINE_RESPONSE_SCHEMA_VERSION =
  "prism.browser-baseline-response/v1" as const;
export const BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION =
  "prism.browser-action-proposal/v1" as const;
export const BROWSER_ACTION_RECORD_SCHEMA_VERSION =
  "prism.browser-action-record/v1" as const;

const absoluteWorkspacePathPattern = /^(?:[a-z]:[\\/]|\/)/i;

function hasUnsupportedControlCharacter(value: string): boolean {
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
        (value) => value.trim().length >= 6,
        "Describe one visible frontend problem in at least 6 characters.",
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
      "run_storage_error",
      "run_not_found",
      "invalid_workspace_request",
      "workspace_execution_error",
      "invalid_browser_baseline_request",
      "browser_baseline_not_configured",
      "browser_execution_error",
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

export const runIdSchema = z
  .string()
  .regex(
    /^run_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Run IDs must use the supported run_<uuid> format.",
  );

const isoDateTimeSchema = z.string().datetime({ offset: true });

export const artifactRefSchema = z
  .object({
    schemaVersion: z.literal(ARTIFACT_REF_SCHEMA_VERSION),
    algorithm: z.literal("sha256"),
    hash: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Artifact hashes must be lowercase SHA-256 digests."),
    byteLength: z.number().int().nonnegative(),
    mediaType: z
      .string()
      .min(3)
      .max(160)
      .regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/),
  })
  .strict();

const sha256Schema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Values must use a lowercase SHA-256 digest.");

const browserRouteSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("\\"),
    "Browser routes must be normalized local paths.",
  );

const semanticBrowserTargetSchema = z
  .object({
    kind: z.literal("semantic"),
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(240),
    exact: z.boolean(),
  })
  .strict();

const hybridBrowserTargetSchema = z
  .object({
    kind: z.literal("hybrid"),
    role: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(240),
    exact: z.boolean(),
    grounding: z
      .object({
        x: z.number().nonnegative(),
        y: z.number().nonnegative(),
        width: z.number().positive(),
        height: z.number().positive(),
      })
      .strict(),
  })
  .strict();

export const browserObservationReferenceSchema = z
  .object({
    observationId: z.string().uuid(),
    url: z.string().url().max(2_048),
    viewport: viewportSchema,
    pageStateHash: sha256Schema,
    screenshotHash: sha256Schema,
  })
  .strict();

const coordinateBrowserTargetSchema = z
  .object({
    kind: z.literal("coordinate"),
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    observationId: z.string().uuid(),
    screenshotHash: sha256Schema,
    pageStateHash: sha256Schema,
    viewport: viewportSchema,
  })
  .strict()
  .refine(
    (target) => target.x < target.viewport.width && target.y < target.viewport.height,
    "Coordinate targets must remain inside their bound viewport.",
  );

export const browserTargetSchema = z.discriminatedUnion("kind", [
  semanticBrowserTargetSchema,
  hybridBrowserTargetSchema,
  coordinateBrowserTargetSchema,
]);

export const browserCaptureTargetSchema = z.discriminatedUnion("kind", [
  semanticBrowserTargetSchema,
  hybridBrowserTargetSchema,
]);

export const browserBaselineRequestSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_BASELINE_REQUEST_SCHEMA_VERSION),
    requestId: z.string().uuid(),
    runId: runIdSchema,
    route: browserRouteSchema,
    target: browserCaptureTargetSchema,
  })
  .strict();

export const browserBaselineRecordSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_BASELINE_SCHEMA_VERSION),
    baselineId: z.string().uuid(),
    runId: runIdSchema,
    buildIdentity: z.string().trim().min(1).max(200),
    route: browserRouteSchema,
    browserVersion: z.string().trim().min(1).max(200),
    viewport: viewportSchema,
    devicePixelRatio: z.number().positive().max(8),
    target: browserTargetSchema,
    targetIdentity: z.string().trim().min(1).max(500),
    observation: browserObservationReferenceSchema,
    screenshot: artifactRefSchema,
    dom: artifactRefSchema,
    accessibility: artifactRefSchema,
    computed: artifactRefSchema,
    console: artifactRefSchema,
    network: artifactRefSchema,
    trace: artifactRefSchema,
    capturedAt: isoDateTimeSchema,
    supplementalVisualJudgment: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict()
  .superRefine((baseline, context) => {
    if (baseline.observation.screenshotHash !== baseline.screenshot.hash) {
      context.addIssue({
        code: "custom",
        path: ["observation", "screenshotHash"],
        message: "The observation must reference the committed screenshot artifact.",
      });
    }
  });

export const browserBaselineResponseSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_BASELINE_RESPONSE_SCHEMA_VERSION),
    baseline: browserBaselineRecordSchema,
  })
  .strict();

export const browserActionProposalSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_ACTION_PROPOSAL_SCHEMA_VERSION),
    proposalId: z.string().uuid(),
    runId: runIdSchema,
    origin: z.enum(["ui-tars", "automation"]),
    action: z.object({ kind: z.literal("click") }).strict(),
    target: browserTargetSchema,
  })
  .strict();

export const browserActionRecordSchema = z
  .object({
    schemaVersion: z.literal(BROWSER_ACTION_RECORD_SCHEMA_VERSION),
    proposal: browserActionProposalSchema,
    policy: z
      .object({
        decision: z.enum(["allowed", "denied", "stale"]),
        reason: z.string().trim().min(1).max(500),
      })
      .strict(),
    execution: z
      .object({
        status: z.enum(["executed", "denied", "stale", "failed"]),
        message: z.string().trim().min(1).max(500),
      })
      .strict(),
    before: browserObservationReferenceSchema,
    after: browserObservationReferenceSchema.nullable(),
    recordedAt: isoDateTimeSchema,
  })
  .strict();

const relativeWorkspacePathSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      value === "." ||
      (!value.startsWith("/") &&
        !value.startsWith("\\") &&
        !/^[a-z]:/i.test(value) &&
        !value.includes("\\") &&
        value
          .split("/")
          .every((segment) => segment !== "" && segment !== "." && segment !== "..")),
    "Workspace paths must be normalized relative paths without traversal.",
  );

const workspaceGlobSchema = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.startsWith("\\") &&
      !/^[a-z]:/i.test(value) &&
      !value.includes("\\") &&
      !value.split("/").includes(".."),
    "Workspace globs must stay relative to the workspace.",
  );

export const workspaceCommandSchema = z
  .object({
    executable: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\w.+-]+$/),
    arguments: z
      .array(
        z
          .string()
          .max(500)
          .regex(/^[^\0\r\n]*$/),
      )
      .max(32),
  })
  .strict();

const workspaceRequestEnvelopeShape = {
  schemaVersion: z.literal(WORKSPACE_REQUEST_SCHEMA_VERSION),
  requestId: z.string().uuid(),
  runId: runIdSchema,
};

export const workspaceInspectRequestSchema = z
  .object({
    ...workspaceRequestEnvelopeShape,
    operation: z.literal("inspect"),
    paths: z.array(relativeWorkspacePathSchema).max(24),
    patterns: z.array(workspaceGlobSchema).max(24),
  })
  .strict();

export const workspaceTestRequestSchema = z
  .object({
    ...workspaceRequestEnvelopeShape,
    operation: z.literal("test"),
    command: workspaceCommandSchema,
    workingDirectory: relativeWorkspacePathSchema,
    timeoutMs: z.number().int().min(50).max(120_000),
  })
  .strict();

export const workspacePatchRequestSchema = z
  .object({
    ...workspaceRequestEnvelopeShape,
    operation: z.literal("patch"),
    files: z
      .array(
        z
          .object({
            path: relativeWorkspacePathSchema,
            expectedSha256: z
              .string()
              .regex(/^[0-9a-f]{64}$/)
              .nullable(),
            content: z.string().max(262_144),
          })
          .strict(),
      )
      .min(1)
      .max(1),
  })
  .strict();

export const workspaceRequestSchema = z.discriminatedUnion("operation", [
  workspaceInspectRequestSchema,
  workspaceTestRequestSchema,
  workspacePatchRequestSchema,
]);

const workspaceReadEvidenceSchema = z
  .object({
    path: relativeWorkspacePathSchema,
    byteLength: z.number().int().nonnegative(),
    capturedSha256: z.string().regex(/^[0-9a-f]{64}$/),
    content: z.string(),
    truncated: z.boolean(),
    redactionCount: z.number().int().nonnegative(),
  })
  .strict();

const workspaceInspectDetailsSchema = z
  .object({
    operation: z.literal("inspect"),
    reads: z.array(workspaceReadEvidenceSchema),
    discoveredPaths: z.array(relativeWorkspacePathSchema),
    discoveryTruncated: z.boolean(),
  })
  .strict();

const workspaceTestDetailsSchema = z
  .object({
    operation: z.literal("test"),
    command: workspaceCommandSchema,
    workingDirectory: relativeWorkspacePathSchema,
    exitCode: z.number().int().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    outputTruncated: z.boolean(),
    redactionCount: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  })
  .strict();

const workspacePatchDetailsSchema = z
  .object({
    operation: z.literal("patch"),
    files: z.array(
      z
        .object({
          path: relativeWorkspacePathSchema,
          beforeSha256: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .nullable(),
          afterSha256: z.string().regex(/^[0-9a-f]{64}$/),
          byteLength: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

export const workspaceEvidenceSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EVIDENCE_SCHEMA_VERSION),
    requestId: z.string().uuid(),
    runId: runIdSchema,
    operation: z.enum(["inspect", "test", "patch"]),
    status: z.enum(["succeeded", "denied", "failed", "timed_out", "cancelled"]),
    reasonCode: z
      .enum([
        "path_escape",
        "symlink_escape",
        "path_not_allowlisted",
        "pattern_not_allowlisted",
        "command_not_allowlisted",
        "working_directory_not_allowlisted",
        "patch_conflict",
        "output_limit",
        "execution_failed",
      ])
      .nullable(),
    summary: z.string().min(1).max(500),
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    details: z.discriminatedUnion("operation", [
      workspaceInspectDetailsSchema,
      workspaceTestDetailsSchema,
      workspacePatchDetailsSchema,
    ]),
  })
  .strict();

export const workspaceEvidenceRecordSchema = z
  .object({
    evidence: workspaceEvidenceSchema,
    artifact: artifactRefSchema,
  })
  .strict();

export const workspaceEvidenceResponseSchema = z
  .object({
    schemaVersion: z.literal(WORKSPACE_EVIDENCE_RESPONSE_SCHEMA_VERSION),
    record: workspaceEvidenceRecordSchema,
  })
  .strict();

export const terminalRunErrorSchema = z
  .object({
    code: z.enum([
      "corrupt_event",
      "corrupt_artifact",
      "corrupt_manifest",
      "storage_error",
    ]),
    message: z.string().min(1).max(500),
  })
  .strict();

export const runManifestSchema = z
  .object({
    schemaVersion: z.literal(RUN_MANIFEST_SCHEMA_VERSION),
    runId: runIdSchema,
    createdAt: isoDateTimeSchema,
    request: repairRequestSchema,
    requestArtifact: artifactRefSchema,
  })
  .strict();

const runEventEnvelopeShape = {
  schemaVersion: z.literal(RUN_EVENT_SCHEMA_VERSION),
  eventId: z.string().uuid(),
  runId: runIdSchema,
  sequence: z.number().int().positive(),
  recordedAt: isoDateTimeSchema,
  correlationId: z.string().min(1).max(200),
  causationEventId: z.string().uuid().nullable(),
};

export const runCreatedEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.created"),
    payload: z.object({ requestArtifact: artifactRefSchema }).strict(),
  })
  .strict();

export const runQueuedEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.queued"),
    payload: z.object({}).strict(),
  })
  .strict();

export const runTerminalErrorEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("run.terminal-error"),
    payload: terminalRunErrorSchema,
  })
  .strict();

export const workspaceEvidenceEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("workspace.evidence"),
    payload: workspaceEvidenceRecordSchema,
  })
  .strict();

export const browserBaselineEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("browser.baseline"),
    payload: browserBaselineRecordSchema,
  })
  .strict();

export const browserActionEventSchema = z
  .object({
    ...runEventEnvelopeShape,
    type: z.literal("browser.action"),
    payload: browserActionRecordSchema,
  })
  .strict();

export const runEventSchema = z.discriminatedUnion("type", [
  runCreatedEventSchema,
  runQueuedEventSchema,
  runTerminalErrorEventSchema,
  workspaceEvidenceEventSchema,
  browserBaselineEventSchema,
  browserActionEventSchema,
]);

export const runStatusSchema = z.enum(["created", "queued", "terminal_error"]);

export const runSnapshotSchema = z
  .object({
    schemaVersion: z.literal(RUN_SNAPSHOT_SCHEMA_VERSION),
    runId: runIdSchema,
    title: z.string().min(1).max(160),
    status: runStatusSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    lastSequence: z.number().int().nonnegative(),
    artifacts: z.array(artifactRefSchema),
    workspaceEvidence: z.array(workspaceEvidenceRecordSchema).default([]),
    browserBaselines: z.array(browserBaselineRecordSchema).default([]),
    browserActions: z.array(browserActionRecordSchema).default([]),
    terminalError: terminalRunErrorSchema.nullable(),
  })
  .strict();

export const runCreationSchema = z
  .object({
    schemaVersion: z.literal(RUN_CREATION_SCHEMA_VERSION),
    status: z.literal("created"),
    runId: runIdSchema,
    snapshot: runSnapshotSchema,
  })
  .strict();

export const runSummarySchema = z
  .object({
    id: runIdSchema,
    title: z.string().min(1).max(160),
    status: runStatusSchema,
    createdAt: isoDateTimeSchema.nullable(),
    updatedAt: isoDateTimeSchema.nullable(),
    lastSequence: z.number().int().nonnegative(),
    integrity: z.enum(["verified", "failed"]),
  })
  .strict();

export const runDossierSchema = runSummarySchema
  .extend({
    prompt: z.string().nullable(),
    workspace: localWorkspaceSchema.nullable(),
    viewport: viewportSchema.nullable(),
    artifacts: z.array(artifactRefSchema),
    workspaceEvidence: z.array(workspaceEvidenceRecordSchema).default([]),
    browserBaselines: z.array(browserBaselineRecordSchema).default([]),
    browserActions: z.array(browserActionRecordSchema).default([]),
    terminalError: terminalRunErrorSchema.nullable(),
  })
  .strict();

export const runListSchema = z
  .object({
    schemaVersion: z.literal(RUN_LIST_SCHEMA_VERSION),
    runs: z.array(runSummarySchema),
  })
  .strict();

export const runDossierResponseSchema = z
  .object({
    schemaVersion: z.literal(RUN_DOSSIER_RESPONSE_SCHEMA_VERSION),
    dossier: runDossierSchema,
  })
  .strict();

export type ArtifactRef = z.infer<typeof artifactRefSchema>;
export type BrowserActionProposal = z.infer<typeof browserActionProposalSchema>;
export type BrowserActionRecord = z.infer<typeof browserActionRecordSchema>;
export type BrowserBaselineRecord = z.infer<typeof browserBaselineRecordSchema>;
export type BrowserBaselineRequest = z.infer<typeof browserBaselineRequestSchema>;
export type BrowserBaselineResponse = z.infer<typeof browserBaselineResponseSchema>;
export type BrowserCaptureTarget = z.infer<typeof browserCaptureTargetSchema>;
export type BrowserObservationReference = z.infer<typeof browserObservationReferenceSchema>;
export type BrowserTarget = z.infer<typeof browserTargetSchema>;
export type RunCreation = z.infer<typeof runCreationSchema>;
export type RunDossier = z.infer<typeof runDossierSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
export type RunList = z.infer<typeof runListSchema>;
export type RunManifest = z.infer<typeof runManifestSchema>;
export type RunSnapshot = z.infer<typeof runSnapshotSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type TerminalRunError = z.infer<typeof terminalRunErrorSchema>;
export type WorkspaceCommand = z.infer<typeof workspaceCommandSchema>;
export type WorkspaceEvidence = z.infer<typeof workspaceEvidenceSchema>;
export type WorkspaceEvidenceRecord = z.infer<typeof workspaceEvidenceRecordSchema>;
export type WorkspaceEvidenceResponse = z.infer<typeof workspaceEvidenceResponseSchema>;
export type WorkspaceRequest = z.infer<typeof workspaceRequestSchema>;

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
