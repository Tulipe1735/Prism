import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Arch, build as packageApp, Platform } from "electron-builder";
import { build as bundle } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const staging = join(root, ".packaging");
const cache = join(staging, "cache");
const runtime = join(staging, "runtime");
const resources = join(staging, "resources/runtime");
const app = join(staging, "app");
const nodeVersion = "22.23.2";
const metadata: {
  version: string;
  description: string;
  license: string;
  repository: unknown;
} = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const localRequire = createRequire(import.meta.url);
const electronVersion: string = localRequire("electron/package.json").version;

await mkdir(cache, { recursive: true });
// Downloaded build helpers are CommonJS, independent of the project's module type.
await writeFile(join(cache, "package.json"), '{"type":"commonjs"}\n');
for (const directory of [runtime, resources, app]) {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
}
console.log("Preparing the Linux kernel and its runtime…");
await bundle({
  entryPoints: [join(root, "src/interfaces/kernel.ts")],
  outfile: join(runtime, "kernel.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["playwright"],
  legalComments: "linked",
  define: { "import.meta.url": "__prismModuleUrl" },
  banner: {
    js: 'const __prismModuleUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});
await cp(join(root, "src/browser/snapshot.js"), join(runtime, "snapshot.js"));
await cp(join(root, "skills"), join(runtime, "skills"), { recursive: true });
await cp(join(root, "LICENSE"), join(runtime, "LICENSE"));
await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(runtime, "THIRD_PARTY_NOTICES.md"));
await writeFile(
  join(runtime, "package.json"),
  JSON.stringify(
    { name: "prism-kernel", version: metadata.version, type: "module" },
    null,
    2,
  ),
);

// Playwright reads its own assets at runtime. Ship its two published packages intact.
const playwrightManifest = localRequire.resolve("playwright/package.json");
const playwrightRequire = createRequire(playwrightManifest);
for (const [name, manifest] of [
  ["playwright", playwrightManifest],
  ["playwright-core", playwrightRequire.resolve("playwright-core/package.json")],
]) {
  await cp(dirname(manifest!), join(runtime, "node_modules", name!), {
    recursive: true,
    dereference: true,
  });
}

const filename = `node-v${nodeVersion}-linux-x64.tar.xz`;
const nodeUrl = `https://nodejs.org/dist/v${nodeVersion}/`;
const checksums = await downloadText(`${nodeUrl}SHASUMS256.txt`);
const checksum = checksums
  .split("\n")
  .find((line) => line.endsWith(`  ${filename}`))
  ?.split(" ")[0];
if (checksum === undefined || !/^[\da-f]{64}$/.test(checksum))
  throw new Error("The Node release checksum is missing");
const archive = join(cache, filename);
let content = await readFile(archive).catch(() => null);
if (content === null || sha256(content) !== checksum) {
  console.log(`Downloading Linux Node ${nodeVersion}…`);
  const response = await fetch(`${nodeUrl}${filename}`);
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
  content = Buffer.from(await response.arrayBuffer());
  if (sha256(content) !== checksum)
    throw new Error("Node download checksum did not match");
  await writeFile(archive, content);
}
await mkdir(join(runtime, "node"), { recursive: true });
execFileSync(
  "tar",
  [
    "-xf",
    archive,
    "--strip-components=1",
    "-C",
    join(runtime, "node"),
    `node-v${nodeVersion}-linux-x64/bin/node`,
    `node-v${nodeVersion}-linux-x64/LICENSE`,
  ],
  { stdio: "inherit" },
);
const payload = join(resources, "prism-kernel.tar.gz");
execFileSync("tar", ["-czf", payload, "-C", runtime, "."], { stdio: "inherit" });
await writeFile(
  join(resources, "manifest.json"),
  `${JSON.stringify({ version: metadata.version, nodeVersion, arch: "x64", sha256: sha256(await readFile(payload)) }, null, 2)}\n`,
);

for (const directory of ["dist/workbench/electron", "dist/workbench-ui"])
  await cp(join(root, directory), join(app, directory), {
    recursive: true,
    filter: (path) => !path.endsWith(".map"),
  });
await cp(join(root, "LICENSE"), join(app, "LICENSE"));
await writeFile(
  join(app, "package.json"),
  `${JSON.stringify(
    {
      name: "prism",
      productName: "Prism",
      version: metadata.version,
      description: metadata.description,
      license: metadata.license,
      author: "Tulipe1735",
      repository: metadata.repository,
      type: "module",
      main: "dist/workbench/electron/main.js",
    },
    null,
    2,
  )}\n`,
);

process.env.ELECTRON_BUILDER_CACHE ??= join(cache, "electron-builder");
console.log("Building the Windows x64 installer…");
await packageApp({
  projectDir: app,
  targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64),
  publish: "never",
  config: {
    appId: "io.github.tulipe1735.prism",
    productName: "Prism",
    electronVersion,
    electronDownload: { cache: join(cache, "electron") },
    directories: {
      app,
      output: join(root, "release"),
      buildResources: join(root, "src/workbench/ui/assets"),
    },
    files: ["dist/**/*", "package.json", "LICENSE"],
    extraResources: [{ from: resources, to: "runtime" }],
    asar: true,
    // The desktop shell is already bundled and has no external Node dependencies.
    beforeBuild: async () => false,
    // electron-builder expands these tokens when it names the installer.
    // eslint-disable-next-line no-template-curly-in-string
    artifactName: "Prism-${version}-Setup-${arch}.${ext}",
    win: {
      target: [{ target: "nsis", arch: ["x64"] }],
      icon: join(root, "src/workbench/ui/assets/prism-icon.png"),
      signExecutable: false,
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: "Prism",
      runAfterFinish: false,
      installerLanguages: ["zh_CN", "en_US"],
      displayLanguageSelector: true,
      deleteAppDataOnUninstall: false,
    },
  },
});
console.log(`Installer ready in ${resolve(root, "release")}`);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
async function downloadText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Download failed: HTTP ${response.status} (${url})`);
  return response.text();
}
