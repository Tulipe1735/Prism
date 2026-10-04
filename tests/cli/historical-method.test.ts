import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

const hash = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

it("preserves the historical method in its frozen archive and untouched evidence outside the archive", async () => {
  // A refactored checkout cannot equal the old CLI. Never rewrite the historical manifest
  // to make it pass: verify archived source and the remaining original evidence instead.
  const freeze = JSON.parse(
    await readFile("evals/cohorts/external-validation-v1.freeze.json", "utf8"),
  );
  const archive = freeze.source_archive;
  expect(hash(await readFile(archive.path))).toBe(archive.sha256);
  const paths = new Set(
    execFileSync("tar", ["-tf", archive.path], { encoding: "utf8" }).split("\n"),
  );
  const inventory: Record<string, string> = JSON.parse(
    await readFile("evals/cohorts/external-validation-v1.historical.json", "utf8"),
  );
  for (const [path, expected] of Object.entries(inventory)) {
    const bytes = paths.has(path)
      ? execFileSync("tar", ["-xOf", archive.path, path])
      : await readFile(path);
    expect(hash(bytes), path).toBe(expected);
  }
});
