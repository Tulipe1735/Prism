import { createVitestConfig } from "@prism/tooling-config/vitest";

export default createVitestConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
