import { defineConfig } from "tsup";

export default defineConfig({
  target: "node22",
  platform: "node",
  removeNodeProtocol: false,
  entry: {
    cli: "src/interfaces/cli.ts",
    daemon: "src/interfaces/daemon.ts",
    kernel: "src/interfaces/kernel.ts",
  },
});
