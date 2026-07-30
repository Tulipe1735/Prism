import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const prototypeRoot = path.join(webRoot, "app", "prototype");
const productionRoots = ["app", "components", "lib"].map((directory) =>
  path.join(webRoot, directory),
);
const prototypeSignatures = [
  "PrismPrototype",
  "PR-2048",
  "Round the Save button",
  "recentCases",
  "RECENT CASES",
] as const;

async function collectTypeScriptSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entryPath === prototypeRoot) {
          return [];
        }

        return collectTypeScriptSources(entryPath);
      }

      return /\.(?:ts|tsx)$/.test(entry.name)
        ? [await readFile(entryPath, "utf8")]
        : [];
    }),
  );

  return sources.flat();
}

describe("selected Field Desk prototype regression", () => {
  it("keeps the approved prototype route and its comparison record intact", async () => {
    const routeSource = await readFile(
      path.join(prototypeRoot, "prism", "page.tsx"),
      "utf8",
    );
    const prototypeSource = await readFile(
      path.join(prototypeRoot, "prism", "PrismPrototype.tsx"),
      "utf8",
    );

    expect(routeSource).toContain("PrismPrototype");
    expect(prototypeSource).toContain("PR-2048");
    expect(prototypeSource).toContain("Round the Save button");
    expect(prototypeSource).toContain("RECENT CASES");
  });

  it("keeps prototype records out of the production source tree", async () => {
    const productionSource = (
      await Promise.all(productionRoots.map(collectTypeScriptSources))
    )
      .flat()
      .join("\n");

    for (const signature of prototypeSignatures) {
      expect(productionSource).not.toContain(signature);
    }
  });
});
