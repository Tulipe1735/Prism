import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const MAIN = resolve("dist/workbench/electron/main.cjs");
const UI_ROOT = resolve("dist/workbench-ui");

function builtEntry(): string {
  return readFileSync(MAIN, "utf8");
}

/**
 * Both checks read the built entry because the shell has no behaviour to test
 * on its own: it only wires the kernel and the UI server together, and only
 * Electron resolves its imports. The full path is covered by
 * `electron.smoke.test.ts` where a runtime and a display exist.
 */
it.skipIf(!existsSync(MAIN))(
  "keeps the runtime's electron module external, so the entry loads",
  () => {
    // Electron supplies `electron` itself. The npm package of the same name
    // only spawns the binary and does not expose the runtime's app API.
    expect(builtEntry().includes('require("electron")')).toBe(true);
    expect(builtEntry().includes("node_modules/electron/index.js")).toBe(false);
  },
);

it.skipIf(!existsSync(MAIN))("serves the UI from dist/workbench-ui", () => {
  // The UI server defaults to its own module directory, which the inlined copy
  // inside this bundle turns into dist/workbench/electron.
  expect(builtEntry()).toContain('"dist/workbench-ui"');
  expect(existsSync(join(UI_ROOT, "index.html"))).toBe(true);
});
