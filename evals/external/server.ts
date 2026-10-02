import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

export const sourceRoot = resolve(".scratch/external-validation-v1/sources");

/** Replay unchanged published files. No task-specific page generation or rewrites. */
export async function startExternalSources(
  port = 9842,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(
          new URL(request.url ?? "/", "http://local").pathname,
        );
        const path = resolve(sourceRoot, `.${pathname}`);
        if (!path.startsWith(`${sourceRoot}${sep}`)) {
          response.writeHead(404).end();
          return;
        }
        const data = await readFile(path);
        const mime: Record<string, string> = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".jpg": "image/jpeg",
        };
        response.writeHead(200, {
          "content-type": mime[extname(path)] ?? "application/octet-stream",
        });
        response.end(data);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      }),
  };
}
