import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);

/** The desktop kernel must compile and install bundles without a system Node or pnpm. */
export async function copyPluginRuntime(
  destination: string,
  platforms: string[],
): Promise<void> {
  const esbuildManifest = require.resolve("esbuild/package.json");
  await cp(dirname(esbuildManifest), join(destination, "node_modules/esbuild"), {
    recursive: true,
    dereference: true,
  });
  await cp(dirname(require.resolve("pnpm")), join(destination, "node_modules/pnpm"), {
    recursive: true,
    dereference: true,
  });
  const { version } = JSON.parse(await readFile(esbuildManifest, "utf8")) as {
    version: string;
  };
  const resolveBinary = createRequire(esbuildManifest);
  for (const platform of platforms) {
    const name = `@esbuild/${platform}`;
    const target = join(destination, "node_modules", name);
    const installed = (() => {
      try {
        return dirname(resolveBinary.resolve(`${name}/package.json`));
      } catch {
        return undefined;
      }
    })();
    if (installed !== undefined) {
      await cp(installed, target, { recursive: true, dereference: true });
      continue;
    }
    const metadataResponse = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`,
    );
    if (!metadataResponse.ok)
      throw new Error(
        `Cannot resolve ${name}@${version}: HTTP ${metadataResponse.status}`,
      );
    const metadata = (await metadataResponse.json()) as {
      dist: { tarball: string; integrity: string };
    };
    if (!metadata.dist.integrity.startsWith("sha512-"))
      throw new Error(`Missing SHA-512 integrity for ${name}`);
    const response = await fetch(metadata.dist.tarball);
    if (!response.ok)
      throw new Error(`Cannot download ${name}: HTTP ${response.status}`);
    const content = new Uint8Array(await response.arrayBuffer());
    if (
      `sha512-${createHash("sha512").update(content).digest("base64")}` !==
      metadata.dist.integrity
    )
      throw new Error(`Integrity mismatch for ${name}`);
    await mkdir(target, { recursive: true });
    const archive = join(destination, `.${platform}.tgz`);
    await writeFile(archive, content);
    try {
      await execute("tar", ["-xf", archive, "--strip-components=1", "-C", target]);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(archive, { force: true });
    }
  }
  await mkdir(join(destination, "plugin-sdk"), { recursive: true });
  await cp(
    fileURLToPath(new URL("../packages/plugin-sdk/src/client.ts", import.meta.url)),
    join(destination, "plugin-sdk/client.ts"),
  );
}
