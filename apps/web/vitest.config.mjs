import { fileURLToPath } from "node:url";

import { createVitestConfig } from "@prism/tooling-config/vitest";

export default createVitestConfig({
  resolve: {
    alias: {
      "@prism/workspace-executor": fileURLToPath(
        new URL("../../packages/workspace-executor/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.test.ts"],
  },
});
