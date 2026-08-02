import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceExecutor } from "./index";

const runId = "run_6dbf6f33-69c4-4e5f-9898-3f693735f5f0";
let root: string;
let outside: string;
let executor: WorkspaceExecutor;

function requestId(suffix: number) {
  return `42ee0dfc-a713-49b9-bc60-8c72cced2a2${suffix}`;
}

function testRequest(script: string, timeoutMs = 2_000) {
  return {
    schemaVersion: "prism.workspace-request/v1",
    requestId: requestId(4),
    runId,
    operation: "test",
    command: { executable: "node", arguments: [script] },
    workingDirectory: ".",
    timeoutMs,
  } as const;
}

async function heartbeatStops(filePath: string) {
  const first = await stat(filePath);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const second = await stat(filePath);
  expect(second.size).toBe(first.size);
  expect(second.mtimeMs).toBe(first.mtimeMs);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "prism-workspace-"));
  outside = await mkdtemp(path.join(tmpdir(), "prism-outside-"));
  await mkdir(path.join(root, "src"));
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "package.json"), '{"name":"fixture"}\n');
  await writeFile(
    path.join(root, "src", "visible.ts"),
    "export const visible = true;\n",
  );
  await writeFile(path.join(root, "src", "ignored.ts"), "do not discover\n");
  await writeFile(path.join(root, ".gitignore"), "src/ignored.ts\n");
  await writeFile(path.join(root, "nested", ".gitignore"), "ignored.ts\n");
  await writeFile(path.join(root, "nested", "ignored.ts"), "nested ignore\n");
  await writeFile(path.join(outside, "secret.txt"), "token=outside-secret\n");
  await symlink(outside, path.join(root, "linked"), "junction");
  await writeFile(
    path.join(root, "pass.mjs"),
    'console.log("passed token=" + process.env.PRISM_TEST_SECRET);\n',
  );
  await writeFile(path.join(root, "large.mjs"), 'console.log("x".repeat(8_192));\n');
  await writeFile(
    path.join(root, "heartbeat.mjs"),
    [
      'import { appendFileSync } from "node:fs";',
      "const file = process.argv[2];",
      'setInterval(() => appendFileSync(file, "."), 20);',
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "tree.mjs"),
    [
      'import { spawn } from "node:child_process";',
      'const child = spawn(process.execPath, ["heartbeat.mjs", process.argv[2]], { stdio: "ignore" });',
      "console.log(child.pid);",
      "setInterval(() => {}, 1_000);",
    ].join("\n"),
  );

  executor = await WorkspaceExecutor.create({
    workspaceRoot: root,
    allowedReadPatterns: ["package.json", "src/**/*.ts", "**/*.txt"],
    allowedDiscoveryPatterns: ["**/*.ts"],
    allowedCommands: [
      {
        command: { executable: "node", arguments: ["pass.mjs"] },
        workingDirectories: ["."],
      },
      {
        command: { executable: "node", arguments: ["large.mjs"] },
        workingDirectories: ["."],
      },
      {
        command: { executable: "node", arguments: ["tree.mjs", "timeout-heartbeat"] },
        workingDirectories: ["."],
      },
      {
        command: { executable: "node", arguments: ["tree.mjs", "cancel-heartbeat"] },
        workingDirectories: ["."],
      },
    ],
    environment: { PRISM_TEST_SECRET: "inside-secret" },
    redactedValues: ["inside-secret", "outside-secret"],
    limits: { maxOutputBytes: 4_096, maxReadBytes: 4_096, maxDiscoveredFiles: 20 },
  });
});

afterEach(async () => {
  await Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true }),
  ]);
});

describe("WorkspaceExecutor", () => {
  it("reads allowlisted files and discovers files through repository ignore rules", async () => {
    const evidence = await executor.execute({
      schemaVersion: "prism.workspace-request/v1",
      requestId: requestId(1),
      runId,
      operation: "inspect",
      paths: ["package.json"],
      patterns: ["**/*.ts"],
    });

    expect(evidence).toMatchObject({
      status: "succeeded",
      details: {
        operation: "inspect",
        discoveredPaths: ["src/visible.ts"],
        reads: [{ path: "package.json", content: '{"name":"fixture"}\n' }],
      },
    });
  });

  it("runs only an exact allowlisted test shape and redacts its bounded output", async () => {
    const evidence = await executor.execute(testRequest("pass.mjs"));

    expect(evidence).toMatchObject({
      status: "succeeded",
      details: { operation: "test", exitCode: 0, redactionCount: 1 },
    });
    expect(evidence.details.operation === "test" && evidence.details.stdout).toContain(
      "[REDACTED]",
    );
    expect(JSON.stringify(evidence)).not.toContain("inside-secret");

    const denied = await executor.execute({
      ...testRequest("pass.mjs"),
      command: { executable: "node", arguments: ["-e", "process.exit(0)"] },
    });
    expect(denied).toMatchObject({
      status: "denied",
      reasonCode: "command_not_allowlisted",
    });
  });

  it("fails closed on traversal, symlink escape, and an unexpected working directory", async () => {
    const traversal = await executor.execute({
      schemaVersion: "prism.workspace-request/v1",
      requestId: requestId(2),
      runId,
      operation: "inspect",
      paths: ["../secret.txt"],
      patterns: [],
    });
    expect(traversal).toMatchObject({ status: "denied", reasonCode: "path_escape" });

    const symlinked = await executor.execute({
      schemaVersion: "prism.workspace-request/v1",
      requestId: requestId(3),
      runId,
      operation: "inspect",
      paths: ["linked/secret.txt"],
      patterns: [],
    });
    expect(symlinked).toMatchObject({
      status: "denied",
      reasonCode: "symlink_escape",
    });

    const wrongDirectory = await executor.execute({
      ...testRequest("pass.mjs"),
      workingDirectory: "src",
    });
    expect(wrongDirectory).toMatchObject({
      status: "denied",
      reasonCode: "working_directory_not_allowlisted",
    });
  });

  it("terminates a command whose output exceeds the evidence boundary", async () => {
    const evidence = await executor.execute(testRequest("large.mjs"));

    expect(evidence).toMatchObject({
      status: "failed",
      reasonCode: "output_limit",
      details: { operation: "test", outputTruncated: true },
    });
    expect(
      evidence.details.operation === "test" && evidence.details.stdout.length,
    ).toBeLessThanOrEqual(4_096);
  });

  it("applies a hash-guarded patch inside the workspace and rejects a symlink write", async () => {
    const source = await readFile(path.join(root, "src", "visible.ts"));
    const { createHash } = await import("node:crypto");
    const expectedSha256 = createHash("sha256").update(source).digest("hex");
    const patched = await executor.execute({
      schemaVersion: "prism.workspace-request/v1",
      requestId: requestId(5),
      runId,
      operation: "patch",
      files: [
        {
          path: "src/visible.ts",
          expectedSha256,
          content: "export const visible = false;\n",
        },
      ],
    });
    expect(patched).toMatchObject({ status: "succeeded", operation: "patch" });
    expect(await readFile(path.join(root, "src", "visible.ts"), "utf8")).toContain(
      "false",
    );

    const escaped = await executor.execute({
      schemaVersion: "prism.workspace-request/v1",
      requestId: requestId(6),
      runId,
      operation: "patch",
      files: [
        {
          path: "linked/secret.txt",
          expectedSha256: null,
          content: "overwrite\n",
        },
      ],
    });
    expect(escaped).toMatchObject({ status: "denied", reasonCode: "symlink_escape" });
    expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toContain(
      "outside-secret",
    );
  });

  it("times out and terminates the complete spawned process tree", async () => {
    const heartbeat = path.join(root, "timeout-heartbeat");
    const evidence = await executor.execute({
      ...testRequest("tree.mjs", 120),
      command: {
        executable: "node",
        arguments: ["tree.mjs", "timeout-heartbeat"],
      },
    });

    expect(evidence.status).toBe("timed_out");
    await heartbeatStops(heartbeat);
  });

  it("cancels and terminates the complete spawned process tree", async () => {
    const heartbeat = path.join(root, "cancel-heartbeat");
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 120);
    const evidence = await executor.execute(
      {
        ...testRequest("tree.mjs", 2_000),
        command: {
          executable: "node",
          arguments: ["tree.mjs", "cancel-heartbeat"],
        },
      },
      { signal: controller.signal },
    );

    expect(evidence.status).toBe("cancelled");
    await heartbeatStops(heartbeat);
  });
});
