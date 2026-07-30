import { createVitestConfig } from "@prism/tooling-config/vitest";

export default createVitestConfig({
  test: {
    include: ["**/*.test.ts"],
  },
});
