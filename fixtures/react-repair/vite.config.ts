import { fileURLToPath } from "node:url";

import { createVitestConfig } from "@prism/tooling-config/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig(
  createVitestConfig({
    resolve: {
      alias: {
        "@prism/contracts": fileURLToPath(
          new URL("../../packages/contracts/src/index.ts", import.meta.url),
        ),
      },
    },
    test: {
      include: ["src/**/*.test.tsx"],
    },
    esbuild: {
      jsx: "automatic",
    },
  }),
);
