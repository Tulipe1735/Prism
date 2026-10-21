import { expect, it } from "vitest";
import { rendererContentSecurityPolicy } from "../../src/workbench/electron/content-security-policy.ts";

it("allows generated font bindings only in the bundled font worker", () => {
  const worker = rendererContentSecurityPolicy("/subset-worker.chunk-RUEQIUAV.js");
  expect(worker).toContain("script-src 'self' 'unsafe-eval'");
  expect(worker).toContain("default-src 'none'");
  expect(worker).toContain("connect-src 'self'");
});

it.each([
  "/",
  "/index.html",
  "/app.js",
  "/canvas-EM7OTHBP.js",
  "/chunk-T76IIYZW.js",
  "/subset-worker.chunk-RUEQIUAV.js.html",
  "/nested/subset-worker.chunk-RUEQIUAV.js",
])("keeps string evaluation blocked in the renderer at %s", (pathname) => {
  const policy = rendererContentSecurityPolicy(pathname);
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain("base-uri 'self'");
});
