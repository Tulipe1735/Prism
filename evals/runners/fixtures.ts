import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const fixtureRoot = resolve(
  fileURLToPath(new URL("../fixtures/", import.meta.url)),
);

export async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const path = resolve(directory, entry.name);
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) await visit(path, name);
      else if (entry.isFile()) hash.update(name).update(await readFile(path));
    }
  }
  await visit(root, "");
  return hash.digest("hex");
}

export async function startFixtures(port = 0): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(
          new URL(request.url ?? "/", "http://local").pathname,
        );
        const path = resolve(fixtureRoot, `.${pathname}`);
        if (
          !path.startsWith(`${fixtureRoot}${sep}`) ||
          ![".html", ".js"].includes(extname(path))
        ) {
          response.writeHead(404).end();
          return;
        }
        const content = await readFile(path);
        response.writeHead(200, {
          "content-type":
            extname(path) === ".html"
              ? "text/html; charset=utf-8"
              : "text/javascript; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(content);
      } catch {
        if (!response.headersSent) response.writeHead(404);
        response.end();
      }
    })();
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () =>
      new Promise((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
        server.closeAllConnections();
      }),
  };
}
