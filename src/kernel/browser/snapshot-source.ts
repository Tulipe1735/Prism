import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The page script the browser module injects, read once.
 *
 * The script is shared with the external CLI face: it stays at
 * `src/browser/snapshot.js` in the sources, and the build copies it next to
 * every bundle (`dist/snapshot.js`), like it does for the CLI. The bundle and
 * the sources therefore look in different places for the same file.
 */
export const SNAPSHOT_SOURCE = readSnapshotSource(import.meta.url);

/** Where the script is looked for, most specific to a bundle first. */
export function snapshotSourceCandidates(moduleUrl: string): URL[] {
  return [
    new URL("./snapshot.js", moduleUrl),
    new URL("../../browser/snapshot.js", moduleUrl),
  ];
}

export function readSnapshotSource(moduleUrl: string): string {
  const candidates = snapshotSourceCandidates(moduleUrl);
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      // Try the next location; the last failure explains both.
    }
  }
  throw new Error(
    `The browser page script is missing; looked in ${candidates
      .map((candidate) => fileURLToPath(candidate))
      .join(
        " and ",
      )}. Run the build so the script is copied next to the kernel bundle.`,
  );
}
