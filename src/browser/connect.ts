import CDP from "chrome-remote-interface";

import { ConfigError } from "../errors.ts";

export interface CdpClient {
  send: (method: string, params?: object, sessionId?: string) => Promise<any>;
}

export interface BrowserConnection {
  client: CdpClient;
  close: () => Promise<void>;
}

export interface ConnectBrowserOptions {
  host?: string;
  port?: number;
}

export async function connectBrowser(
  options: ConnectBrowserOptions = {},
): Promise<BrowserConnection> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 9222;
  const endpoint = `http://${host}:${port}`;

  let version: { webSocketDebuggerUrl?: string };
  try {
    version = (await CDP.Version({ host, port })) as { webSocketDebuggerUrl?: string };
  } catch {
    throw new ConfigError(connectionHelp(endpoint));
  }

  const webSocketUrl = version.webSocketDebuggerUrl;
  if (typeof webSocketUrl !== "string" || webSocketUrl.length === 0) {
    throw new ConfigError(connectionHelp(endpoint));
  }

  const client = await CDP({ target: webSocketUrl });
  return {
    client: client as unknown as CdpClient,
    close: () => client.close(),
  };
}

export function parseBrowserUrl(url: string): { host: string; port: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid --browser-url "${url}". Use http://host:port.`);
  }
  const port =
    parsed.port.length > 0
      ? Number(parsed.port)
      : parsed.protocol === "https:"
        ? 443
        : 80;
  return { host: parsed.hostname, port };
}

function connectionHelp(endpoint: string): string {
  return [
    `No Chrome DevTools endpoint at ${endpoint}.`,
    "Start Chrome with remote debugging before running Prism, then retry.",
    "Chrome 136+ refuses remote debugging on the default profile; use a dedicated profile and sign in there once:",
    '  macOS:   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"',
    '  Linux:   google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.prism-chrome"',
    '  Windows: "%PROGRAMFILES%\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\\.prism-chrome"',
    "Point Prism at another port with --browser-url http://127.0.0.1:<port>.",
  ].join("\n");
}
