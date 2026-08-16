import type { BrowserSessionFactory } from "@prism/runtime-browser";
import type { PiSessionFactory } from "@prism/runtime-pi";
import type { AddressInfo } from "node:net";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import {
  type BrowserResourceUsage,
  type RepairRequest,
  workspaceEvidenceRecordSchema,
} from "@prism/contracts";
import { FileTrajectoryStore } from "@prism/trajectory-store";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  createRun,
  decideRunEffect,
  startHybridRun,
  waitForHybridRun,
} from "./run-repository";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const fixtureRoot = path.join(repositoryRoot, "fixtures", "react-repair");
const prompt = "Make the primary Save button clearly rounded instead of square.";

let dataDirectory: string;
let fixtureDirectory: string;
let server: Server;
let previousDataDirectory: string | undefined;
let previousBrowserBaseUrl: string | undefined;

beforeEach(async () => {
  previousDataDirectory = process.env.PRISM_DATA_DIR;
  previousBrowserBaseUrl = process.env.PRISM_BROWSER_BASE_URL;
  dataDirectory = await mkdtemp(path.join(repositoryRoot, ".tmp-prism-data-"));
  fixtureDirectory = await mkdtemp(
    path.join(repositoryRoot, "fixtures", ".tmp-round-button-"),
  );
  await cp(fixtureRoot, fixtureDirectory, {
    recursive: true,
    filter: (source) =>
      !["node_modules", "dist", ".turbo"].includes(path.basename(source)),
  });
  await symlink(
    path.join(fixtureRoot, "node_modules"),
    path.join(fixtureDirectory, "node_modules"),
  );
  await execFileAsync("git", ["init", "--quiet"], { cwd: fixtureDirectory });
  await execFileAsync("git", ["add", "."], { cwd: fixtureDirectory });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Prism Test",
      "-c",
      "user.email=prism@example.test",
      "commit",
      "--quiet",
      "-m",
      "known bad",
    ],
    { cwd: fixtureDirectory },
  );
  await execFileAsync("pnpm", ["build"], { cwd: fixtureDirectory });
  const started = await createStaticServer(path.join(fixtureDirectory, "dist"));
  server = started.server;
  process.env.PRISM_DATA_DIR = dataDirectory;
  process.env.PRISM_BROWSER_BASE_URL = started.url;
}, 60_000);

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await Promise.all([
    rm(dataDirectory, { recursive: true, force: true }),
    rm(fixtureDirectory, { recursive: true, force: true }),
  ]);
  restoreEnvironment("PRISM_DATA_DIR", previousDataDirectory);
  restoreEnvironment("PRISM_BROWSER_BASE_URL", previousBrowserBaseUrl);
}, 60_000);

it("completes the round-button request with replayable dual-Oracle evidence", async () => {
  const request: RepairRequest = {
    schemaVersion: "prism.repair-request/v1",
    prompt,
    workspace: {
      kind: "local",
      path: fixtureDirectory,
      displayName: "round-button-fixture",
    },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  };
  const creation = await createRun(request);

  await startHybridRun(creation.runId, {
    piSessionFactory: roundButtonPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(),
    browserConfig: {
      route: "/round-button",
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
    },
  });
  const paused = await waitForHybridRun(creation.runId);
  expect(paused).toMatchObject({
    status: "awaiting_approval",
    browserBaselines: [expect.objectContaining({ route: "/round-button" })],
    effectControls: [
      expect.objectContaining({
        kind: "proposal",
        runId: creation.runId,
        origin: "pi",
        effectClass: "source_effect",
        preconditions: expect.objectContaining({ fencingToken: 1 }),
      }),
    ],
  });
  expect(
    paused?.nodeProgress.some(
      ({ nodeType, state }) => nodeType === "workspace.patch" && state === "succeeded",
    ),
  ).toBe(false);
  const proposal = paused?.effectControls.find(
    (control) => control.kind === "proposal",
  );
  if (!proposal || proposal.kind !== "proposal") throw new Error("Missing proposal");
  await decideRunEffect(creation.runId, {
    schemaVersion: "prism.effect-decision-request/v1",
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    decision: "approved",
  });
  await expect(
    decideRunEffect(creation.runId, {
      schemaVersion: "prism.effect-decision-request/v1",
      proposalId: proposal.proposalId,
      proposalDigest: proposal.proposalDigest,
      decision: "approved",
    }),
  ).rejects.toThrow("does not match the pending proposal");

  const recoveryStore = new FileTrajectoryStore({ dataDirectory });
  await recoveryStore.recordEffectLease(creation.runId, {
    schemaVersion: "prism.effect-lease/v1",
    token: proposal.preconditions.fencingToken,
    holderNodeId: proposal.nodeId,
    effectClass: "source_effect",
    state: "active",
    recordedAt: new Date().toISOString(),
  });
  await recoveryStore.recordEffectControl(creation.runId, {
    schemaVersion: "prism.effect-control/v1",
    kind: "consumption",
    controlId: randomUUID(),
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    nodeId: proposal.nodeId,
    fencingToken: proposal.preconditions.fencingToken,
    recordedAt: new Date().toISOString(),
  });

  // Simulate a process loss after authority consumption but before any source mutation.
  await startHybridRun(creation.runId, {
    piSessionFactory: roundButtonPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(),
  });
  const recovered = await waitForHybridRun(creation.runId);
  expect(recovered).toMatchObject({
    status: "awaiting_approval",
    effectLease: { token: 1, state: "released" },
    effectControls: expect.arrayContaining([
      expect.objectContaining({
        kind: "reconciliation",
        outcome: "no_effect",
        action: "repropose",
      }),
      expect.objectContaining({
        kind: "proposal",
        preconditions: expect.objectContaining({ fencingToken: 2 }),
      }),
    ]),
  });
  const recoveredProposal = [...(recovered?.effectControls ?? [])]
    .reverse()
    .find((control) => control.kind === "proposal");
  if (!recoveredProposal || recoveredProposal.kind !== "proposal") {
    throw new Error("Missing recovered proposal");
  }
  await decideRunEffect(creation.runId, {
    schemaVersion: "prism.effect-decision-request/v1",
    proposalId: recoveredProposal.proposalId,
    proposalDigest: recoveredProposal.proposalDigest,
    decision: "approved",
  });

  await startHybridRun(creation.runId, {
    piSessionFactory: roundButtonPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(),
    browserConfig: {
      route: "/round-button",
      target: { kind: "semantic", role: "button", name: "Save", exact: true },
    },
  });
  const dossier = await waitForHybridRun(creation.runId);

  expect(dossier).toMatchObject({
    status: "completed",
    prompt,
    repairSpec: {
      spec: {
        prompt,
        predicates: expect.arrayContaining([
          expect.objectContaining({
            kind: "metric-increase",
            metric: "borderRadius",
            minDeltaPx: 8,
          }),
          { kind: "label-preserved" },
          { kind: "clickable" },
        ]),
      },
      artifact: {
        mediaType: "application/vnd.prism.frontend-repair-spec+json",
      },
    },
    browserBaselines: [
      expect.objectContaining({
        route: "/round-button",
        target: expect.objectContaining({ role: "button", name: "Save" }),
      }),
    ],
    browserVerificationReports: [
      expect.objectContaining({
        verdict: "passed",
        assertions: expect.arrayContaining([
          expect.objectContaining({
            kind: "deterministic",
            status: "passed",
          }),
        ]),
      }),
    ],
    nodeProgress: expect.arrayContaining([
      expect.objectContaining({
        nodeType: "task.complete",
        state: "succeeded",
      }),
    ]),
    effectLease: expect.objectContaining({ state: "released" }),
    completion: {
      approvals: ["source_effect"],
      codeOracle: expect.objectContaining({
        mediaType: "application/vnd.prism.code-oracle-report+json",
      }),
      browserVerificationReportId: expect.any(String),
      verificationRefs: expect.arrayContaining([
        expect.objectContaining({ algorithm: "sha256" }),
      ]),
    },
  });
  expect(dossier?.browserBaselines).toHaveLength(1);
  expect(
    dossier?.nodeProgress.filter(
      ({ nodeType, state }) => nodeType === "browser.observe" && state === "succeeded",
    ),
  ).toHaveLength(1);

  const replayed = await new FileTrajectoryStore({ dataDirectory }).loadRun(
    creation.runId,
  );
  expect(replayed.snapshot).toMatchObject({
    status: dossier?.status,
    dagRevisions: dossier?.dagRevisions,
    effectLease: dossier?.effectLease,
    effectControls: dossier?.effectControls,
    completion: dossier?.completion,
  });
}, 60_000);

it("completes the card-shadow repair with baseline, dual-Oracle, and replay evidence", async () => {
  const cardPrompt =
    "Restore a subtle but visible shadow to the profile card without moving it.";
  const creation = await createRun({
    schemaVersion: "prism.repair-request/v1",
    prompt: cardPrompt,
    workspace: {
      kind: "local",
      path: fixtureDirectory,
      displayName: "card-shadow-fixture",
    },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const browserConfig = {
    route: "/card-shadow",
    target: {
      kind: "semantic" as const,
      role: "region",
      name: "Profile card",
      exact: true,
    },
  };

  await startHybridRun(creation.runId, {
    piSessionFactory: cardShadowPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(
      "card-shadow",
      "The profile card has a subtle visible shadow and did not move.",
    ),
    browserConfig,
  });
  const paused = await waitForHybridRun(creation.runId);
  expect(paused).toMatchObject({
    status: "awaiting_approval",
    browserBaselines: [expect.objectContaining({ route: "/card-shadow" })],
  });
  const baseline = paused?.browserBaselines[0];
  if (!baseline) throw new Error("Missing card-shadow baseline");
  const store = new FileTrajectoryStore({ dataDirectory });
  const computed = JSON.parse(
    Buffer.from(await store.readArtifact(baseline.computed)).toString("utf8"),
  );
  expect(computed).toMatchObject({
    rectangle: expect.objectContaining({ width: 360, height: 180 }),
    parentRectangle: expect.objectContaining({ width: 1280 }),
    siblingRectangles: [expect.objectContaining({ width: expect.any(Number) })],
    styles: { boxShadow: "none" },
  });

  const proposal = paused?.effectControls.find(
    (control) => control.kind === "proposal",
  );
  if (!proposal || proposal.kind !== "proposal") throw new Error("Missing proposal");
  await decideRunEffect(creation.runId, {
    schemaVersion: "prism.effect-decision-request/v1",
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    decision: "approved",
  });
  await startHybridRun(creation.runId, {
    piSessionFactory: cardShadowPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(
      "card-shadow",
      "The profile card has a subtle visible shadow and did not move.",
    ),
    browserConfig,
  });
  const dossier = await waitForHybridRun(creation.runId);

  expect(dossier).toMatchObject({
    status: "completed",
    prompt: cardPrompt,
    repairSpec: {
      spec: {
        predicates: expect.arrayContaining([
          { kind: "shadow-present" },
          { kind: "surroundings-within", tolerancePx: 2 },
        ]),
      },
    },
    browserVerificationReports: [expect.objectContaining({ verdict: "passed" })],
    completion: {
      approvals: ["source_effect"],
      codeOracle: expect.objectContaining({
        mediaType: "application/vnd.prism.code-oracle-report+json",
      }),
      browserVerificationReportId: expect.any(String),
      verificationRefs: expect.any(Array),
    },
  });
  const replayed = await store.loadRun(creation.runId);
  expect(replayed.snapshot).toMatchObject({
    status: dossier?.status,
    completion: dossier?.completion,
    browserVerificationReports: dossier?.browserVerificationReports,
  });
}, 60_000);

it("repairs the profile Dialog with brokered keyboard and focus evidence", async () => {
  const dialogPrompt = "The Edit profile button does nothing; make it open the dialog.";
  const creation = await createRun({
    schemaVersion: "prism.repair-request/v1",
    prompt: dialogPrompt,
    workspace: {
      kind: "local",
      path: fixtureDirectory,
      displayName: "profile-dialog-fixture",
    },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const browserConfig = {
    route: "/profile-dialog",
    target: {
      kind: "semantic" as const,
      role: "button",
      name: "Edit profile",
      exact: true,
    },
  };

  await startHybridRun(creation.runId, {
    piSessionFactory: profileDialogPiSessionFactory(),
    browserSessionFactory: profileDialogBrowserSessionFactory(),
    browserConfig,
  });
  const paused = await waitForHybridRun(creation.runId);
  expect(paused).toMatchObject({
    status: "awaiting_approval",
    browserBaselines: [expect.objectContaining({ route: "/profile-dialog" })],
    browserActions: expect.arrayContaining([
      expect.objectContaining({
        proposal: expect.objectContaining({
          action: { kind: "press", key: "Tab" },
        }),
        execution: expect.objectContaining({ status: "executed" }),
      }),
      expect.objectContaining({
        proposal: expect.objectContaining({
          action: { kind: "press", key: "Enter" },
        }),
        execution: expect.objectContaining({ status: "executed" }),
      }),
    ]),
  });
  const baseline = paused?.browserBaselines[0];
  if (!baseline) throw new Error("Missing profile Dialog baseline");
  const store = new FileTrajectoryStore({ dataDirectory });
  const computed = JSON.parse(
    Buffer.from(await store.readArtifact(baseline.computed)).toString("utf8"),
  );
  const consoleEvidence = JSON.parse(
    Buffer.from(await store.readArtifact(baseline.console)).toString("utf8"),
  );
  expect(computed.dialogs).toContainEqual({
    name: "Edit profile",
    open: false,
    visible: false,
  });
  expect(computed.activeElement).toMatchObject({ tagName: "BODY" });
  expect(
    consoleEvidence.filter(({ type }: { type: string }) => type === "error"),
  ).toEqual([]);

  const proposal = paused?.effectControls.find(
    (control) => control.kind === "proposal",
  );
  if (!proposal || proposal.kind !== "proposal") throw new Error("Missing proposal");
  await decideRunEffect(creation.runId, {
    schemaVersion: "prism.effect-decision-request/v1",
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    decision: "approved",
  });
  await startHybridRun(creation.runId, {
    piSessionFactory: profileDialogPiSessionFactory(),
    browserSessionFactory: profileDialogBrowserSessionFactory(),
    browserConfig,
  });
  const dossier = await waitForHybridRun(creation.runId);

  expect(dossier).toMatchObject({
    status: "completed",
    prompt: dialogPrompt,
    repairSpec: {
      spec: {
        predicates: [{ kind: "dialog-behavior", dialogName: "Edit profile" }],
      },
    },
    browserActions: expect.arrayContaining([
      expect.objectContaining({
        proposal: expect.objectContaining({
          action: { kind: "press", key: "Escape" },
        }),
        execution: expect.objectContaining({ status: "executed" }),
      }),
    ]),
    browserVerificationReports: [expect.objectContaining({ verdict: "passed" })],
    completion: {
      approvals: ["source_effect"],
      codeOracle: expect.objectContaining({
        mediaType: "application/vnd.prism.code-oracle-report+json",
      }),
      browserVerificationReportId: expect.any(String),
      verificationRefs: expect.any(Array),
    },
  });
  const replayed = await store.loadRun(creation.runId);
  expect(replayed.snapshot).toMatchObject({
    status: dossier?.status,
    browserActions: dossier?.browserActions,
    browserVerificationReports: dossier?.browserVerificationReports,
    completion: dossier?.completion,
  });
}, 60_000);

it("repairs form enablement across empty, invalid, and valid keyboard input", async () => {
  const formPrompt = "Submit remains disabled after I enter a valid email.";
  const creation = await createRun({
    schemaVersion: "prism.repair-request/v1",
    prompt: formPrompt,
    workspace: {
      kind: "local",
      path: fixtureDirectory,
      displayName: "form-enablement-fixture",
    },
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  });
  const browserConfig = {
    route: "/form-enablement",
    target: {
      kind: "semantic" as const,
      role: "button",
      name: "Submit",
      exact: true,
    },
  };

  await startHybridRun(creation.runId, {
    piSessionFactory: formEnablementPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(
      "form-enablement",
      "Valid keyboard input enabled Submit while invalid input stayed disabled.",
    ),
    browserConfig,
  });
  const paused = await waitForHybridRun(creation.runId);
  expect(paused).toMatchObject({
    status: "awaiting_approval",
    browserBaselines: [expect.objectContaining({ route: "/form-enablement" })],
  });
  const baseline = paused?.browserBaselines[0];
  if (!baseline) throw new Error("Missing form-enablement baseline");
  const store = new FileTrajectoryStore({ dataDirectory });
  const computed = JSON.parse(
    Buffer.from(await store.readArtifact(baseline.computed)).toString("utf8"),
  );
  expect(computed).toMatchObject({
    enabled: false,
    accessibilityDisabled: true,
  });

  const proposal = paused?.effectControls.find(
    (control) => control.kind === "proposal",
  );
  if (!proposal || proposal.kind !== "proposal") throw new Error("Missing proposal");
  await decideRunEffect(creation.runId, {
    schemaVersion: "prism.effect-decision-request/v1",
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    decision: "approved",
  });
  await startHybridRun(creation.runId, {
    piSessionFactory: formEnablementPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(
      "form-enablement",
      "Valid keyboard input enabled Submit while invalid input stayed disabled.",
    ),
    browserConfig,
  });
  const dossier = await waitForHybridRun(creation.runId);

  expect(dossier).toMatchObject({
    status: "completed",
    prompt: formPrompt,
    repairSpec: {
      spec: {
        predicates: [expect.objectContaining({ kind: "form-enablement" })],
      },
    },
    browserVerificationReports: [expect.objectContaining({ verdict: "passed" })],
    completion: {
      approvals: ["source_effect"],
      codeOracle: expect.objectContaining({
        mediaType: "application/vnd.prism.code-oracle-report+json",
      }),
      browserVerificationReportId: expect.any(String),
      verificationRefs: expect.any(Array),
    },
  });
  const evaluationRef = dossier?.artifacts.find(
    ({ mediaType }) =>
      mediaType === "application/vnd.prism.browser-oracle-evaluation+json",
  );
  if (!evaluationRef) throw new Error("Missing form Oracle evidence");
  const evaluation = JSON.parse(
    Buffer.from(await store.readArtifact(evaluationRef)).toString("utf8"),
  );
  expect(evaluation).toMatchObject({
    before: {
      form: {
        empty: { enabled: false, accessibilityDisabled: true },
        invalid: { enabled: false, accessibilityDisabled: true },
        valid: { enabled: false, accessibilityDisabled: true },
      },
    },
    after: {
      form: {
        empty: { enabled: false, accessibilityDisabled: true },
        invalid: { enabled: false, accessibilityDisabled: true },
        valid: { enabled: true, accessibilityDisabled: false },
        keyboardFocusReachedTarget: true,
        consoleErrors: [],
      },
    },
    evaluation: { verdict: "passed" },
  });
  const replayed = await store.loadRun(creation.runId);
  expect(replayed.snapshot).toMatchObject({
    status: dossier?.status,
    browserVerificationReports: dossier?.browserVerificationReports,
    completion: dossier?.completion,
  });
}, 60_000);

it("repairs mobile checkout overflow without moving the desktop layout", async () => {
  const mobilePrompt = "Checkout actions overflow off-screen on mobile.";
  const creation = await createRun({
    schemaVersion: "prism.repair-request/v1",
    prompt: mobilePrompt,
    workspace: {
      kind: "local",
      path: fixtureDirectory,
      displayName: "mobile-overflow-fixture",
    },
    viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
  });
  const browserConfig = {
    route: "/mobile-overflow",
    target: {
      kind: "semantic" as const,
      role: "region",
      name: "Checkout actions",
      exact: true,
    },
  };

  await startHybridRun(creation.runId, {
    piSessionFactory: mobileOverflowPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(
      "mobile-overflow",
      "Every checkout action is visible on mobile and desktop stayed stable.",
    ),
    browserConfig,
  });
  const paused = await waitForHybridRun(creation.runId);
  expect(paused).toMatchObject({
    status: "awaiting_approval",
    browserBaselines: [
      expect.objectContaining({
        route: "/mobile-overflow",
        viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
      }),
    ],
  });
  const baseline = paused?.browserBaselines[0];
  if (!baseline) throw new Error("Missing mobile-overflow baseline");
  const store = new FileTrajectoryStore({ dataDirectory });
  const computed = JSON.parse(
    Buffer.from(await store.readArtifact(baseline.computed)).toString("utf8"),
  );
  expect(computed.responsiveLayout).toMatchObject({
    viewport: { width: 390, height: 844 },
    horizontalOverflow: expect.any(Number),
    targetInsideViewport: false,
    targetClipped: true,
    actionsInsideViewport: false,
    actionsOverlap: false,
  });
  expect(computed.responsiveLayout.horizontalOverflow).toBeGreaterThan(0);

  const proposal = paused?.effectControls.find(
    (control) => control.kind === "proposal",
  );
  if (!proposal || proposal.kind !== "proposal") throw new Error("Missing proposal");
  await decideRunEffect(creation.runId, {
    schemaVersion: "prism.effect-decision-request/v1",
    proposalId: proposal.proposalId,
    proposalDigest: proposal.proposalDigest,
    decision: "approved",
  });
  await startHybridRun(creation.runId, {
    piSessionFactory: mobileOverflowPiSessionFactory(),
    browserSessionFactory: successfulBrowserSessionFactory(
      "mobile-overflow",
      "Every checkout action is visible on mobile and desktop stayed stable.",
    ),
    browserConfig,
  });
  const dossier = await waitForHybridRun(creation.runId);

  expect(dossier).toMatchObject({
    status: "completed",
    prompt: mobilePrompt,
    repairSpec: {
      spec: {
        predicates: [expect.objectContaining({ kind: "responsive-layout" })],
      },
    },
    browserVerificationReports: [expect.objectContaining({ verdict: "passed" })],
    completion: {
      approvals: ["source_effect"],
      codeOracle: expect.objectContaining({
        mediaType: "application/vnd.prism.code-oracle-report+json",
      }),
      browserVerificationReportId: expect.any(String),
      verificationRefs: expect.any(Array),
    },
  });
  const evaluationRef = dossier?.artifacts.find(
    ({ mediaType }) =>
      mediaType === "application/vnd.prism.browser-oracle-evaluation+json",
  );
  if (!evaluationRef) throw new Error("Missing responsive Oracle evidence");
  const evaluation = JSON.parse(
    Buffer.from(await store.readArtifact(evaluationRef)).toString("utf8"),
  );
  expect(evaluation).toMatchObject({
    before: {
      layout: {
        targetInsideViewport: false,
        actionsInsideViewport: false,
      },
      desktop: {
        viewport: { width: 1280, height: 720 },
        layout: { horizontalOverflowPx: 0, actionsInsideViewport: true },
      },
    },
    after: {
      layout: {
        horizontalOverflowPx: 0,
        targetInsideViewport: true,
        targetClipped: false,
        actionsInsideViewport: true,
        actionsOverlap: false,
      },
      desktop: {
        viewport: { width: 1280, height: 720 },
        layout: { horizontalOverflowPx: 0, actionsInsideViewport: true },
      },
    },
    evaluation: { verdict: "passed" },
  });
  const replayed = await store.loadRun(creation.runId);
  expect(replayed.snapshot).toMatchObject({
    status: dossier?.status,
    browserVerificationReports: dossier?.browserVerificationReports,
    completion: dossier?.completion,
  });
}, 60_000);

function roundButtonPiSessionFactory(): PiSessionFactory {
  const usage = {
    model: { provider: "scripted", id: "round-button" },
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 12,
    costUsd: 0,
    durationMs: 1,
  };

  return {
    model: usage.model,
    create: async ({ handlers }) => ({
      prompt: async () => {
        const inspected = await handlers.inspect?.({
          paths: ["src/global.css"],
          patterns: [],
        });
        if (handlers.patch && handlers.test) {
          const css = workspaceEvidenceRecordSchema.parse(inspected).evidence.details;
          if (css?.operation !== "inspect") throw new Error("CSS inspection failed.");
          const read = css.reads.find(({ path: file }) => file === "src/global.css");
          if (!read) throw new Error("CSS evidence is missing.");
          await handlers.patch({
            files: [
              {
                path: "src/global.css",
                expectedSha256: createHash("sha256").update(read.content).digest("hex"),
                content: read.content.replace(
                  "border-radius: 0;",
                  "border-radius: 12px;",
                ),
              },
            ],
          });
          await handlers.test({
            command: { executable: "pnpm", arguments: ["test"] },
            workingDirectory: ".",
            timeoutMs: 120_000,
          });
          await handlers.submit({
            state: "succeeded",
            summary: "The scoped round-button repair passed its relevant test.",
            request: { kind: "successor", nodeType: "browser.verify" },
          });
          return;
        }

        await handlers.submit({
          state: "succeeded",
          summary: "The round-button source was inspected.",
          request: { kind: "successor", nodeType: "workspace.patch" },
        });
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => usage,
    }),
  };
}

function cardShadowPiSessionFactory(): PiSessionFactory {
  const usage = {
    model: { provider: "scripted", id: "card-shadow" },
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 12,
    costUsd: 0,
    durationMs: 1,
  };

  return {
    model: usage.model,
    create: async ({ handlers }) => ({
      prompt: async () => {
        const inspected = await handlers.inspect?.({
          paths: ["src/routes/card-shadow.css"],
          patterns: [],
        });
        if (handlers.patch && handlers.test) {
          const details =
            workspaceEvidenceRecordSchema.parse(inspected).evidence.details;
          if (details?.operation !== "inspect")
            throw new Error("CSS inspection failed.");
          const read = details.reads.find(
            ({ path: file }) => file === "src/routes/card-shadow.css",
          );
          if (!read) throw new Error("CSS evidence is missing.");
          await handlers.patch({
            files: [
              {
                path: "src/routes/card-shadow.css",
                expectedSha256: createHash("sha256").update(read.content).digest("hex"),
                content: read.content.replace(
                  "box-shadow: none;",
                  "box-shadow: 0 10px 28px rgba(31, 36, 48, 0.18);",
                ),
              },
            ],
          });
          await handlers.test({
            command: { executable: "pnpm", arguments: ["test"] },
            workingDirectory: ".",
            timeoutMs: 120_000,
          });
          await handlers.submit({
            state: "succeeded",
            summary: "The scoped card-shadow repair passed its relevant test.",
            request: { kind: "successor", nodeType: "browser.verify" },
          });
          return;
        }

        await handlers.submit({
          state: "succeeded",
          summary: "The card-shadow source was inspected.",
          request: { kind: "successor", nodeType: "workspace.patch" },
        });
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => usage,
    }),
  };
}

function profileDialogPiSessionFactory(): PiSessionFactory {
  const usage = {
    model: { provider: "scripted", id: "profile-dialog" },
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 12,
    costUsd: 0,
    durationMs: 1,
  };

  return {
    model: usage.model,
    create: async ({ handlers }) => ({
      prompt: async () => {
        const inspected = await handlers.inspect?.({
          paths: ["src/routes/profile-dialog.tsx"],
          patterns: [],
        });
        if (handlers.patch && handlers.test) {
          const details =
            workspaceEvidenceRecordSchema.parse(inspected).evidence.details;
          if (details?.operation !== "inspect")
            throw new Error("Dialog inspection failed.");
          const read = details.reads.find(
            ({ path: file }) => file === "src/routes/profile-dialog.tsx",
          );
          if (!read) throw new Error("Dialog source evidence is missing.");
          await handlers.patch({
            files: [
              {
                path: "src/routes/profile-dialog.tsx",
                expectedSha256: createHash("sha256").update(read.content).digest("hex"),
                content: read.content.replace(
                  "onClick={() => undefined}",
                  "onClick={() => dialogRef.current?.showModal()}",
                ),
              },
            ],
          });
          await handlers.test({
            command: { executable: "pnpm", arguments: ["test"] },
            workingDirectory: ".",
            timeoutMs: 120_000,
          });
          await handlers.submit({
            state: "succeeded",
            summary: "The scoped profile Dialog repair passed its relevant test.",
            request: { kind: "successor", nodeType: "browser.verify" },
          });
          return;
        }

        await handlers.submit({
          state: "succeeded",
          summary: "The profile Dialog source was inspected.",
          request: { kind: "successor", nodeType: "workspace.patch" },
        });
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => usage,
    }),
  };
}

function formEnablementPiSessionFactory(): PiSessionFactory {
  const usage = {
    model: { provider: "scripted", id: "form-enablement" },
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 12,
    costUsd: 0,
    durationMs: 1,
  };

  return {
    model: usage.model,
    create: async ({ handlers }) => ({
      prompt: async () => {
        const inspected = await handlers.inspect?.({
          paths: ["src/routes/form-enablement.tsx"],
          patterns: [],
        });
        if (handlers.patch && handlers.test) {
          const details =
            workspaceEvidenceRecordSchema.parse(inspected).evidence.details;
          if (details?.operation !== "inspect")
            throw new Error("Form inspection failed.");
          const read = details.reads.find(
            ({ path: file }) => file === "src/routes/form-enablement.tsx",
          );
          if (!read) throw new Error("Form source evidence is missing.");
          await handlers.patch({
            files: [
              {
                path: "src/routes/form-enablement.tsx",
                expectedSha256: createHash("sha256").update(read.content).digest("hex"),
                content: read.content.replace(
                  'disabled={!valid || email.includes("@")}',
                  "disabled={!valid}",
                ),
              },
            ],
          });
          await handlers.test({
            command: { executable: "pnpm", arguments: ["test"] },
            workingDirectory: ".",
            timeoutMs: 120_000,
          });
          await handlers.submit({
            state: "succeeded",
            summary: "The scoped form-enablement repair passed its relevant test.",
            request: { kind: "successor", nodeType: "browser.verify" },
          });
          return;
        }

        await handlers.submit({
          state: "succeeded",
          summary: "The form-enablement source was inspected.",
          request: { kind: "successor", nodeType: "workspace.patch" },
        });
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => usage,
    }),
  };
}

function mobileOverflowPiSessionFactory(): PiSessionFactory {
  const usage = {
    model: { provider: "scripted", id: "mobile-overflow" },
    modelCalls: 1,
    inputTokens: 10,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 12,
    costUsd: 0,
    durationMs: 1,
  };

  return {
    model: usage.model,
    create: async ({ handlers }) => ({
      prompt: async () => {
        const inspected = await handlers.inspect?.({
          paths: ["src/routes/mobile-overflow.css"],
          patterns: [],
        });
        if (handlers.patch && handlers.test) {
          const details =
            workspaceEvidenceRecordSchema.parse(inspected).evidence.details;
          if (details?.operation !== "inspect")
            throw new Error("Mobile layout inspection failed.");
          const read = details.reads.find(
            ({ path: file }) => file === "src/routes/mobile-overflow.css",
          );
          if (!read) throw new Error("Mobile layout source evidence is missing.");
          await handlers.patch({
            files: [
              {
                path: "src/routes/mobile-overflow.css",
                expectedSha256: createHash("sha256").update(read.content).digest("hex"),
                content: read.content.replace("max-width: none;", "max-width: 100%;"),
              },
            ],
          });
          await handlers.test({
            command: { executable: "pnpm", arguments: ["test"] },
            workingDirectory: ".",
            timeoutMs: 120_000,
          });
          await handlers.submit({
            state: "succeeded",
            summary: "The scoped mobile-overflow repair passed its relevant test.",
            request: { kind: "successor", nodeType: "browser.verify" },
          });
          return;
        }

        await handlers.submit({
          state: "succeeded",
          summary: "The mobile-overflow source was inspected.",
          request: { kind: "successor", nodeType: "workspace.patch" },
        });
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => usage,
    }),
  };
}

function profileDialogBrowserSessionFactory(): BrowserSessionFactory {
  const usage: BrowserResourceUsage = {
    model: { provider: "scripted-browser-model", id: "profile-dialog" },
    modelCalls: 1,
    loopCount: 1,
    actionsProposed: 2,
    actionsExecuted: 2,
    costUsd: 0,
    durationMs: 1,
  };
  return {
    model: usage.model,
    create: async ({ operator }) => ({
      run: async () => {
        await operator.screenshot();
        await operator.press("Tab");
        await operator.press("Enter");
        await operator.execute({
          action: "finished",
          judgment: "The named profile Dialog opened and accepted keyboard focus.",
        });
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => usage,
    }),
  };
}

function successfulBrowserSessionFactory(
  id = "round-button",
  judgment = "The rendered Save button is visibly rounded.",
): BrowserSessionFactory {
  const usage: BrowserResourceUsage = {
    model: { provider: "scripted-browser-model", id },
    modelCalls: 1,
    loopCount: 1,
    actionsProposed: 0,
    actionsExecuted: 0,
    costUsd: 0,
    durationMs: 1,
  };
  return {
    model: usage.model,
    create: async ({ operator }) => ({
      run: async () => {
        await operator.screenshot();
        await operator.execute({
          action: "finished",
          judgment,
        });
      },
      abort: async () => undefined,
      dispose: () => undefined,
      getUsage: () => usage,
    }),
  };
}

function createStaticServer(root: string): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const started = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://localhost");
        const hasExtension = /\.[a-z0-9]+$/iu.test(url.pathname);
        const relative = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const requestedPath = hasExtension
          ? path.join(root, relative)
          : path.join(root, "index.html");
        const content = await readFile(requestedPath);
        response.writeHead(200, {
          "content-type": requestedPath.endsWith(".css")
            ? "text/css"
            : requestedPath.endsWith(".js")
              ? "application/javascript"
              : requestedPath.endsWith(".ttf")
                ? "font/ttf"
                : "text/html",
        });
        response.end(content);
      } catch {
        response.writeHead(404);
        response.end("not found");
      }
    });
    started.listen(0, "127.0.0.1", () => {
      resolve({
        server: started,
        url: `http://127.0.0.1:${(started.address() as AddressInfo).port}`,
      });
    });
  });
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
