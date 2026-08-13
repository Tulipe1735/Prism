import type { BrowserSessionFactory } from "@prism/runtime-browser";
import type { PiSessionFactory } from "@prism/runtime-pi";
import type { AddressInfo } from "node:net";
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

function successfulBrowserSessionFactory(): BrowserSessionFactory {
  const usage: BrowserResourceUsage = {
    model: { provider: "scripted-browser-model", id: "round-button" },
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
          judgment: "The rendered Save button is visibly rounded.",
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
