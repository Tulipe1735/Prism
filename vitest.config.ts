import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    passWithNoTests: false,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
