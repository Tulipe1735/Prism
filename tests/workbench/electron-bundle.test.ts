import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const MAIN = resolve("dist/workbench/electron/main.js");
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
    // only spawns the binary; bundling it pulls CommonJS code into the ES
    // module the entry builds to, and its `require("child_process")` throws.
    expect(builtEntry()).toContain('from "electron"');
    expect(builtEntry()).not.toContain("node_modules/electron/index.js");
  },
);

it.skipIf(!existsSync(MAIN))("serves the UI from dist/workbench-ui", () => {
  // The UI server defaults to its own module directory, which the inlined copy
  // inside this bundle turns into dist/workbench/electron.
  expect(builtEntry()).toContain('"dist/workbench-ui"');
  expect(existsSync(join(UI_ROOT, "index.html"))).toBe(true);
});
