import type { AddressInfo } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { webFetch } from "../../src/web/fetch.ts";
import { isPublicAddress, type AddressResolver } from "../../src/web/target.ts";

type Route = (request: IncomingMessage, response: ServerResponse) => void;

const routes = new Map<string, Route>();
let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((request, response) => {
    const route = routes.get(request.url ?? "");
    if (!route) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
      return;
    }
    route(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  server.close();
  await once(server, "close");
});

beforeEach(() => {
  routes.clear();
});

/** Reports a public address for every host name; the fake fetch still reaches the test server. */
const publicResolver: AddressResolver = async () => ["93.184.216.34"];

/** Redirects connections for `public.test` to the local test server. */
function publicFetch(): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    target.hostname = "127.0.0.1";
    target.port = String(port);
    return fetch(target, init);
  }) as typeof fetch;
}

function serve(body: string, contentType: string, status = 200): void {
  routes.set("/page", (_request, response) => {
    response.writeHead(status, { "content-type": contentType });
    response.end(body);
  });
}

const blockedUrls = [
  "http://127.0.0.1/admin",
  "http://127.1.2.3:8080/",
  "http://0.0.0.0/",
  "http://10.1.2.3/",
  "http://172.16.5.5/",
  "http://172.31.255.254/",
  "http://192.168.0.1/router",
  "http://169.254.169.254/latest/meta-data/",
  "http://100.64.0.1/",
  "http://192.0.2.5/",
  "http://198.18.0.1/",
  "http://203.0.113.9/",
  "http://224.0.0.1/",
  "http://240.0.0.1/",
  "http://255.255.255.255/",
  "http://[::1]/",
  "http://[::]/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  "http://[ff02::1]/",
  "http://[2001:db8::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:10.0.0.1]/",
  "http://[2002:7f00:1::]/",
  "http://localhost:3000/",
  "http://api.localhost/",
];

describe("webFetch target policy", () => {
  it.each(blockedUrls)("rejects %s before any network call", async (url) => {
    const fetchImpl = vi.fn();
    await expect(
      webFetch({ url, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/not a public address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP schemes and URLs carrying credentials", async () => {
    const fetchImpl = vi.fn();
    const fetch = fetchImpl as unknown as typeof fetch;
    await expect(webFetch({ url: "file:///etc/passwd", fetchImpl: fetch })).rejects.toThrow(
      /http and https/,
    );
    await expect(
      webFetch({ url: "https://user:secret@example.com/", fetchImpl: fetch }),
    ).rejects.toThrow(/credentials/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a host name that resolves to a private address", async () => {
    const fetchImpl = vi.fn();
    await expect(
      webFetch({
        url: "https://intranet.example.com/wiki",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveAddresses: async () => ["10.0.0.7"],
      }),
    ).rejects.toThrow(/10\.0\.0\.7/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("webFetch page content", () => {
  it("returns the title and readable text of an HTML page", async () => {
    serve(
      `<!doctype html><html><head><title>Prism &amp; docs</title>
       <script>ignore()</script><style>p { color: red }</style></head>
       <body><h1>Setup</h1><p>Run <code>pnpm test</code> to start.</p>
       <ul><li>First</li><li>Second</li></ul></body></html>`,
      "text/html; charset=utf-8",
    );

    const page = await webFetch({
      url: "http://public.test/page",
      fetchImpl: publicFetch(),
      resolveAddresses: publicResolver,
    });

    expect(page).toEqual({
      url: "http://public.test/page",
      title: "Prism & docs",
      text: "Setup\n\nRun pnpm test to start.\n\n * First\n * Second",
      truncated: false,
      contentType: "text/html; charset=utf-8",
    });
  });

  it("resolves relative links against the page and keeps tables readable", async () => {
    serve(
      `<html><head><title>Links</title></head><body>
       <p>Read the <a href="/docs/start">docs</a>.</p>
       <table><tr><th>Name</th><th>Value</th></tr><tr><td>alpha</td><td>1</td></tr></table>
       </body></html>`,
      "text/html",
    );

    const page = await webFetch({
      url: "http://public.test/page",
      fetchImpl: publicFetch(),
      resolveAddresses: publicResolver,
    });

    expect(page.text).toBe(
      "Read the docs [http://public.test/docs/start].\n\nNAME    VALUE\nalpha   1",
    );
  });

  it("returns plain text unchanged and rejects binary content", async () => {
    serve("plain body\nsecond line", "text/plain; charset=utf-8");
    const page = await webFetch({
      url: "http://public.test/page",
      fetchImpl: publicFetch(),
      resolveAddresses: publicResolver,
    });
    expect(page).toEqual({
      url: "http://public.test/page",
      title: "",
      text: "plain body\nsecond line",
      truncated: false,
      contentType: "text/plain; charset=utf-8",
    });

    serve("PNGDATA", "image/png");
    await expect(
      webFetch({
        url: "http://public.test/page",
        fetchImpl: publicFetch(),
        resolveAddresses: publicResolver,
      }),
    ).rejects.toThrow(/image\/png/);
  });
});

describe("webFetch response handling", () => {
  it("follows redirects and reports the final URL", async () => {
    routes.set("/page", (_request, response) => {
      response.writeHead(302, { location: "/moved" });
      response.end();
    });
    routes.set("/moved", (_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><head><title>Moved</title></head><body><p>New home.</p></body></html>");
    });

    const page = await webFetch({
      url: "http://public.test/page",
      fetchImpl: publicFetch(),
      resolveAddresses: publicResolver,
    });

    expect(page.url).toBe("http://public.test/moved");
    expect(page.title).toBe("Moved");
    expect(page.text).toBe("New home.");
  });

  it("refuses redirect targets and redirect chains that leave the public web", async () => {
    routes.set("/private", (_request, response) => {
      response.writeHead(302, { location: "http://127.0.0.1:9999/admin" });
      response.end();
    });
    routes.set("/scheme", (_request, response) => {
      response.writeHead(302, { location: "file:///etc/passwd" });
      response.end();
    });
    routes.set("/nowhere", (_request, response) => {
      response.writeHead(302);
      response.end();
    });
    let hits = 0;
    routes.set("/loop", (_request, response) => {
      hits += 1;
      response.writeHead(302, { location: "/loop" });
      response.end();
    });

    const fetchPage = (path: string, extra = {}) =>
      webFetch({
        url: `http://public.test/${path}`,
        fetchImpl: publicFetch(),
        resolveAddresses: publicResolver,
        ...extra,
      });

    await expect(fetchPage("private")).rejects.toThrow(/127\.0\.0\.1.*not a public address/);
    await expect(fetchPage("scheme")).rejects.toThrow(/http and https/);
    await expect(fetchPage("nowhere")).rejects.toThrow(/without a location/);
    await expect(fetchPage("loop", { maxRedirects: 3 })).rejects.toThrow(/more than 3/);
    expect(hits).toBe(4);
  });

  it("reports an HTTP error status instead of returning its body", async () => {
    serve("not found here", "text/plain", 404);
    await expect(
      webFetch({
        url: "http://public.test/page",
        fetchImpl: publicFetch(),
        resolveAddresses: publicResolver,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.15.0.1",
    "172.32.0.1",
    "11.0.0.1",
    "100.63.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
  ])("accepts the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.0.1",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "192.0.0.1",
    "192.88.99.1",
    "198.19.255.255",
    "224.0.0.1",
    "240.0.0.1",
    "::1",
    "::",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:192.168.0.1",
    "64:ff9b::a00:1",
    "2001::1",
    "2002:c0a8:101::",
    "not-an-address",
  ])("rejects the non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
