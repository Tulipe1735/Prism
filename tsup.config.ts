import { defineConfig } from "tsup";

export default defineConfig({
  target: "node22",
  platform: "node",
  removeNodeProtocol: false,
  entry: {
    cli: "src/interfaces/cli.ts",
    daemon: "src/interfaces/daemon.ts",
    agent: "src/assistant/cli.ts",
  },
  external: [
    "@larksuiteoapi/node-sdk",
    "pdf-parse",
    "mammoth",
    "cheerio",
    "fast-xml-parser",
  ],
});
