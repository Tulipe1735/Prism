import type { PluginBundle } from "../../plugin-sdk/src/index.ts";
import { Buffer } from "node:buffer";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import { UI_SLOTS } from "../../plugin-sdk/src/index.ts";

export const pluginName = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,63}$/)
  .refine((name) => name !== "dependency-policy", "Reserved plugin name");
const version = z.string().regex(/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
export const bundlePath = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (path) =>
      !path.includes("\\") &&
      !path.includes(":") &&
      !path.includes("\0") &&
      !path.startsWith("/") &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "Expected a relative POSIX path",
  );
const packageName = z
  .string()
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/);
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: pluginName,
    version,
    description: z.string().min(1).max(1000),
    backend: bundlePath,
    dependencies: z
      .record(packageName, version)
      .refine((deps) => Object.keys(deps).length <= 32)
      .optional(),
    ui: z
      .array(
        z
          .object({
            id: pluginName,
            slot: z.enum(UI_SLOTS),
            title: z.string().min(1).max(100),
            entry: bundlePath,
          })
          .strict(),
      )
      .max(16)
      .optional(),
    assets: z
      .array(z.object({ from: bundlePath, to: bundlePath }).strict())
      .max(16)
      .optional(),
  })
  .strict();
export const bundleSchema = z
  .object({
    manifest: manifestSchema,
    files: z.record(bundlePath, z.string()),
  })
  .strict()
  .superRefine((bundle, ctx) => {
    const paths = Object.keys(bundle.files);
    if (paths.length > 128 || Buffer.byteLength(JSON.stringify(bundle)) > 1_000_000)
      ctx.addIssue({
        code: "custom",
        message: "Bundle exceeds 128 files or 1 MB of source",
      });
    for (const path of paths) {
      if (
        path
          .split("/")
          .some((part) => ["node_modules", ".git", ".prism-build"].includes(part)) ||
        path === "prism.plugin.json" ||
        path === "package.json"
      )
        ctx.addIssue({ code: "custom", message: `Reserved bundle path: ${path}` });
      if (!/\.(?:[cm]?js|jsx|ts|tsx|json|css|svg|html|txt|md)$/.test(path))
        ctx.addIssue({ code: "custom", message: `Unsupported source file: ${path}` });
      if (paths.some((other) => other !== path && other.startsWith(`${path}/`)))
        ctx.addIssue({ code: "custom", message: `Conflicting bundle path: ${path}` });
    }
    for (const entry of [
      bundle.manifest.backend,
      ...(bundle.manifest.ui ?? []).map((ui) => ui.entry),
    ])
      if (bundle.files[entry] === undefined)
        ctx.addIssue({ code: "custom", message: `Missing entry: ${entry}` });
    const ids = (bundle.manifest.ui ?? []).map((ui) => ui.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate UI contribution id" });
  });

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

/** Development bundles are snapshots, never imports from a mutable author directory. */
export async function readBundle(directory: string): Promise<PluginBundle> {
  const root = await realpath(directory);
  const files: Record<string, string> = {};
  let size = 0;
  async function visit(path: string, prefix = ""): Promise<void> {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (
        ["node_modules", ".git", "dist", ".prism-build"].includes(item.name) ||
        item.name.startsWith(".")
      )
        continue;
      const name = prefix + item.name;
      if (item.isSymbolicLink())
        throw new Error(`Bundle symlinks are not allowed: ${name}`);
      if (item.isDirectory()) await visit(join(path, item.name), `${name}/`);
      else if (
        item.isFile() &&
        name !== "prism.plugin.json" &&
        name !== "package.json" &&
        /\.(?:[cm]?js|jsx|ts|tsx|json|css|svg|html|txt|md)$/.test(name)
      ) {
        size += (await lstat(join(path, item.name))).size;
        if (size > 1_000_000 || Object.keys(files).length >= 128)
          throw new Error("Bundle exceeds source limits");
        files[name] = await readFile(join(path, item.name), "utf8");
      }
    }
  }
  await visit(root);
  const manifestPath = join(root, "prism.plugin.json");
  if ((await lstat(manifestPath)).isSymbolicLink())
    throw new Error("Manifest symlinks are not allowed");
  return bundleSchema.parse({
    manifest: JSON.parse(await readFile(manifestPath, "utf8")),
    files,
  });
}
