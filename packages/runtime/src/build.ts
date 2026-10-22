import type { PluginBuild } from "esbuild";
import type { PluginBundle } from "../../plugin-sdk/src/index.ts";
import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

export interface BuiltBundle {
  revision: string;
  directory: string;
  bundle: PluginBundle;
}

function contains(root: string, path: string): boolean {
  const value = relative(root, path);
  return (
    value === "" ||
    (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`))
  );
}

async function clientSdk(): Promise<string> {
  for (const path of ["./plugin-sdk/client.ts", "../../plugin-sdk/src/client.ts"]) {
    const source = await readFile(
      fileURLToPath(new URL(path, import.meta.url)),
      "utf8",
    ).catch(() => null);
    if (source !== null) return source;
  }
  throw new Error("Plugin client SDK source is missing from this Prism installation.");
}

// Keep the runtime facade usable after the host itself has been bundled.
const pluginErrorSource = `export class PluginError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'PluginError'; this.code = code; this.status = status; }
}`;

/** Bundle every local module so a reload also invalidates its transitive module cache. */
export async function buildBundle(
  bundle: PluginBundle,
  directory: string,
  dependenciesRoot: string,
  revision: string,
  dependencyStoreRoot?: string,
): Promise<BuiltBundle> {
  const source = join(directory, "source");
  const output = join(directory, "build");
  await mkdir(source, { recursive: true });
  for (const [path, content] of Object.entries(bundle.files)) {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), content);
  }
  const nodeModules = join(dependenciesRoot, "node_modules");
  const dependencyRealpath = await realpath(dependencyStoreRoot ?? nodeModules).catch(
    () => nodeModules,
  );
  const common = {
    bundle: true,
    target: "es2022",
    format: "esm" as const,
    nodePaths: [nodeModules],
    logLevel: "silent" as const,
    plugins: [
      {
        name: "prism-bundle-imports",
        setup(builder: PluginBuild) {
          builder.onResolve({ filter: /.*/ }, async (args) => {
            if (args.kind === "entry-point" || args.pluginData === "prism-resolved")
              return;
            if (
              args.path === "@prism/plugin-sdk" ||
              args.path === "@prism/plugin-sdk/client"
            ) {
              // Inline the tiny runtime SDK. This also works in a packaged CJS kernel.
              return {
                path: args.path.endsWith("/client") ? "prism-sdk-client" : "prism-sdk",
                namespace: "prism-sdk",
              };
            }
            if (builtinModules.includes(args.path) || args.path.startsWith("node:")) {
              if (builder.initialOptions.platform === "node")
                return { path: args.path, external: true };
              return {
                errors: [
                  { text: `Node import is unavailable in plugin UI: ${args.path}` },
                ],
              };
            }
            const author = contains(source, args.importer);
            if (author && !args.path.startsWith(".")) {
              const name = args.path.startsWith("@")
                ? args.path.split("/").slice(0, 2).join("/")
                : args.path.split("/")[0]!;
              if (
                isAbsolute(args.path) ||
                bundle.manifest.dependencies?.[name] === undefined
              )
                return {
                  errors: [
                    { text: `Undeclared dependency or absolute import: ${args.path}` },
                  ],
                };
            }
            const result = await builder.resolve(args.path, {
              importer: args.importer,
              resolveDir:
                author && !args.path.startsWith(".")
                  ? dependenciesRoot
                  : args.resolveDir,
              kind: args.kind,
              pluginData: "prism-resolved",
            });
            // Preserve a dependency's optional require/try-catch semantics without
            // letting a missing package fall through to the host's node_modules.
            if (!author && args.kind === "require-call" && result.errors.length > 0)
              return { path: args.path, namespace: "prism-optional-missing" };
            if (result.path !== "" && !result.external) {
              const path = await realpath(result.path).catch(() => result.path);
              if (!contains(source, path) && !contains(dependencyRealpath, path))
                return {
                  errors: [{ text: `Import escapes the bundle: ${args.path}` }],
                };
            }
            return result;
          });
          builder.onLoad({ filter: /.*/, namespace: "prism-sdk" }, async (args) => ({
            contents: args.path === "prism-sdk" ? pluginErrorSource : await clientSdk(),
            loader: "ts",
          }));
          builder.onLoad(
            { filter: /.*/, namespace: "prism-optional-missing" },
            (args) => ({
              contents: `throw Object.assign(new Error(${JSON.stringify(`Optional dependency is not installed: ${args.path}`)}), {code:'MODULE_NOT_FOUND'}); module.exports = undefined;`,
              loader: "js",
            }),
          );
        },
      },
    ],
  };
  await build({
    ...common,
    entryPoints: [join(source, bundle.manifest.backend)],
    outfile: join(output, "backend.cjs"),
    platform: "node",
    format: "cjs",
    define: { "import.meta.url": "__prismPluginUrl" },
    banner: {
      js: 'const __prismPluginUrl = require("node:url").pathToFileURL(__filename).href;',
    },
  });
  for (const ui of bundle.manifest.ui ?? []) {
    const root = join(output, "ui", ui.id);
    await build({
      ...common,
      entryPoints: [join(source, ui.entry)],
      outdir: root,
      entryNames: "entry",
      chunkNames: "chunks/[name]-[hash]",
      assetNames: "assets/[name]-[hash]",
      splitting: true,
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".woff2": "file", ".woff": "file", ".png": "file", ".svg": "file" },
    });
    for (const asset of bundle.manifest.assets ?? []) {
      let from: string;
      if (asset.from.startsWith("node_modules/")) {
        const specifier = asset.from.slice("node_modules/".length);
        const name = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]!;
        if (bundle.manifest.dependencies?.[name] === undefined)
          throw new Error(`Undeclared asset dependency: ${name}`);
        // Resolve via this isolated install, never the host's dependency tree.
        const packageRoot = await realpath(join(nodeModules, name));
        from = resolve(packageRoot, specifier.slice(name.length + 1));
        if (!contains(packageRoot, await realpath(from)))
          throw new Error(`Asset escapes its package: ${asset.from}`);
      } else {
        from = join(source, asset.from);
        if (!contains(source, await realpath(from)))
          throw new Error(`Asset escapes the bundle: ${asset.from}`);
      }
      await cp(from, join(root, asset.to), { recursive: true, dereference: true });
    }
    // Fixed shell; user interface code lives exclusively in the plugin entry.
    if ((await readFile(join(root, "entry.css")).catch(() => null)) === null)
      await writeFile(join(root, "entry.css"), "");
    await writeFile(
      join(root, "boot.js"),
      `const report = error => parent.postMessage({prism:'error', message:error instanceof Error ? error.message : String(error)}, '*');
window.addEventListener('error', event => report(event.error || event.message));
window.addEventListener('unhandledrejection', event => { event.preventDefault(); report(event.reason); });
import('./entry.js').catch(report);\n`,
    );
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./entry.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="./boot.js"></script></body></html>',
    );
  }
  await writeFile(join(directory, "bundle.json"), JSON.stringify(bundle));
  return { revision, directory, bundle };
}
