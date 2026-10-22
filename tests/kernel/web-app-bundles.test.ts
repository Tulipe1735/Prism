import type { PluginBundle } from "../../packages/plugin-sdk/src/index.ts";
import { afterEach, expect, it } from "vitest";
import { bundleSchema } from "../../packages/plugin-manager/src/bundle.ts";
import { KernelClient } from "../../src/workbench/ui/client.ts";
import { pluginBundle } from "../fixtures/plugin.ts";
import { type KernelHarness, startTestKernel } from "./harness.ts";

let harness: KernelHarness | undefined;
afterEach(async () => {
  await harness?.cleanup();
  harness = undefined;
});

function bundle(): PluginBundle {
  const value = pluginBundle("export function apply() {}");
  value.manifest.ui = [
    {
      id: "native",
      title: "Native app",
      slot: "workbench.panel",
      entry: "launcher.ts",
      webApp: {
        url: "https://app.example.com/start",
        origins: ["https://app.example.com"],
        entry: "page.ts",
      },
    },
  ];
  value.files["launcher.ts"] = "document.body.textContent = 'Launcher';";
  value.files["page.ts"] =
    "import './page.css'; document.body.dataset.adapter = 'Native adapter';";
  value.files["page.css"] = ".adapter { color: rebeccapurple; }";
  return value;
}

it("validates exact HTTPS origins and requires an adapter inside the bundle", () => {
  expect(bundleSchema.safeParse(bundle()).success).toBe(true);
  for (const app of [
    { url: "http://app.example.com/start" },
    { url: "https://user:pass@app.example.com/start" },
    { url: "https://other.example.com/start" },
    { origins: ["https://*.example.com"] },
    { origins: ["https://app.example.com/path"] },
    { origins: ["https://app.example.com/"] },
    { origins: [] },
    { entry: "missing.ts" },
    { entry: "../page.ts" },
  ]) {
    const invalid = bundle();
    Object.assign(invalid.manifest.ui![0]!.webApp!, app);
    expect(bundleSchema.safeParse(invalid).success, JSON.stringify(app)).toBe(false);
  }
});

it("builds native JS and CSS as active revision assets, and withdraws them on disable", async () => {
  harness = await startTestKernel({ configFile: { creator: { enabled: true } } });
  const manager = harness.kernel.kernel.ctx.creator;
  await manager.manage({ action: "install", bundle: bundle() });
  expect(manager.ui()).toEqual([]);
  await manager.manage({ action: "enable", name: "wish" });
  const client = new KernelClient({ baseUrl: harness.kernel.url });
  const entry = (await client.pluginUi())[0]!;
  expect(entry.webApp).toMatchObject({
    url: "https://app.example.com/start",
    origins: ["https://app.example.com"],
    scriptUrl: expect.stringMatching(
      /^http:\/\/127\.0\.0\.1:\d+\/plugins\/wish\/assets\/[^/]+\/native\/webapp.js$/,
    ),
  });
  expect(
    await fetch(entry.webApp!.scriptUrl).then((response) => response.text()),
  ).toContain("Native adapter");
  expect(
    await fetch(entry.webApp!.styleUrl).then((response) => response.text()),
  ).toContain("rebeccapurple");
  await manager.manage({ action: "disable", name: "wish" });
  expect(await client.pluginUi()).toEqual([]);
  expect((await fetch(entry.webApp!.scriptUrl)).status).toBe(404);
  expect((await fetch(entry.webApp!.styleUrl)).status).toBe(404);
});

it("rejects Node imports in native page adapters before activation", async () => {
  harness = await startTestKernel({ configFile: { creator: { enabled: true } } });
  const invalid = bundle();
  invalid.files["page.ts"] =
    "import fs from 'node:fs'; fs.readFileSync('/tmp/secret');";
  await expect(
    harness.kernel.kernel.ctx.creator.manage({ action: "install", bundle: invalid }),
  ).rejects.toThrow("Node import is unavailable");
  expect(harness.kernel.kernel.ctx.creator.ui()).toEqual([]);
});
