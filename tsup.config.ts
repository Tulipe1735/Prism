import { defineConfig } from "tsup";

export default defineConfig([
  {
    target: "node22",
    platform: "node",
    format: ["esm"],
    removeNodeProtocol: false,
    entry: {
      cli: "src/interfaces/cli.ts",
      daemon: "src/interfaces/daemon.ts",
      kernel: "src/interfaces/kernel.ts",
      "workbench-ui/server": "src/workbench/interfaces/workbench.ts",
    },
    // Only `dependencies` are external by default; Electron's main process must
    // get the runtime's own `electron` module, not the npm wrapper that spawns
    // the binary (and that no ESM bundle can `require`).
    external: ["electron"],
  },
  {
    entry: { "workbench/electron/main": "src/workbench/electron/main.ts" },
    target: "node22",
    platform: "node",
    format: ["cjs"],
    external: ["electron"],
    noExternal: [/^(?!electron$).+/],
    outExtension: () => ({ js: ".cjs" }),
    define: { "import.meta.url": "__prismModuleUrl" },
    banner: {
      js: 'const __prismModuleUrl = require("node:url").pathToFileURL(__filename).href;',
    },
  },
  {
    entry: {
      app: "src/workbench/ui/main.tsx",
      startup: "src/workbench/ui/startup.tsx",
    },
    outDir: "dist/workbench-ui",
    platform: "browser",
    format: ["esm"],
    target: "es2022",
    tsconfig: "src/workbench/ui/tsconfig.json",
    noExternal: [/.*/],
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
  },
  {
    entry: {
      "workbench/electron/preload": "src/workbench/electron/preload.ts",
      "workbench/electron/web-app-preload": "src/workbench/electron/web-app-preload.ts",
    },
    platform: "node",
    target: "node22",
    format: ["cjs"],
    external: ["electron"],
    noExternal: [/^(?!electron$).+/],
    outExtension: () => ({ js: ".cjs" }),
  },
]);
