import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
