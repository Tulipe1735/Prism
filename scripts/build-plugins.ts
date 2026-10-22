import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBundle } from "../packages/plugin-manager/src/bundle.ts";
import { buildBundle } from "../packages/runtime/src/build.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
for (const entry of await readdir(join(root, "plugins"), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = join(root, "plugins", entry.name);
  const bundle = await readBundle(directory);
  // Shipped plugins use the workspace's frozen pnpm lock; user plugins get isolated installs.
  await buildBundle(
    bundle,
    join(root, "dist/plugins", bundle.manifest.name),
    directory,
    "distribution",
    join(root, "node_modules"),
  );
  console.log(`Built plugin ${bundle.manifest.name}@${bundle.manifest.version}`);
}
