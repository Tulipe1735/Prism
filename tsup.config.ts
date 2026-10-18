import { defineConfig } from "tsup";

export default defineConfig({
  target: "node22",
  platform: "node",
  removeNodeProtocol: false,
  entry: {
    cli: "src/interfaces/cli.ts",
    daemon: "src/interfaces/daemon.ts",
    kernel: "src/interfaces/kernel.ts",
    "workbench-ui/server": "src/workbench/interfaces/workbench.ts",
    "workbench-ui/app": "src/workbench/ui/app.ts",
    "workbench/electron/main": "src/workbench/electron/main.ts",
  },
});
