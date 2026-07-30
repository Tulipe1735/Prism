import { defineConfig, mergeConfig } from "vitest/config";

const sharedConfig = defineConfig({
  test: {
    environment: "node",
    passWithNoTests: false,
    restoreMocks: true,
  },
});

export function createVitestConfig(config = {}) {
  return mergeConfig(sharedConfig, defineConfig(config));
}
