import type { AgentSnapshot } from "../../../packages/plugin-sdk/src/index.ts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PluginClient } from "../../../packages/plugin-sdk/src/client.ts";

const parent = { postMessage: vi.fn() };
const listeners = new Set<(event: MessageEvent) => void>();
let client: PluginClient;

function deliver(data: unknown, source: unknown = parent): void {
  for (const listener of listeners) listener({ data, source } as MessageEvent);
}

beforeEach(() => {
  parent.postMessage.mockClear();
  vi.stubGlobal("window", {
    parent,
    addEventListener: (_name: string, listener: (event: MessageEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_name: string, listener: (event: MessageEvent) => void) =>
      listeners.delete(listener),
  });
  client = new PluginClient();
  deliver({ prism: "context", context: { sessionId: "session-one", connected: true } });
});
afterEach(() => {
  client.close();
  listeners.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps Agent requests separate from plugin RPC and accepts results only from its parent", async () => {
  const read = client.agent.read();
  expect(parent.postMessage).toHaveBeenLastCalledWith(
    {
      prism: "host.request",
      id: 1,
      method: "agent.read",
      input: undefined,
      sessionId: "session-one",
    },
    "*",
    [],
  );
  let settled = false;
  void read.then(() => {
    settled = true;
  });
  deliver({ prism: "result", id: 1, result: "wrong source" }, {});
  await Promise.resolve();
  expect(settled).toBe(false);
  const snapshot: AgentSnapshot = {
    sessionId: "session-one",
    entries: [],
    running: false,
    pending: [],
    approvals: [],
  };
  deliver({ prism: "result", id: 1, result: snapshot });
  expect(await read).toEqual(snapshot);
  const rpc = client.request("echo", { text: "test" });
  expect(parent.postMessage).toHaveBeenLastCalledWith(
    expect.objectContaining({ prism: "request", method: "echo" }),
    "*",
    [],
  );
  deliver({
    prism: "result",
    id: 2,
    error: { code: "RPC_NOT_FOUND", message: "Unavailable" },
  });
  await expect(rpc).rejects.toMatchObject({ code: "RPC_NOT_FOUND" });
});

it("cancels pending calls on timeout, abort, session changes and close", async () => {
  vi.useFakeTimers();
  const timedOut = expect(
    client.request("slow", {}, { timeoutMs: 10 }),
  ).rejects.toMatchObject({ code: "TIMEOUT" });
  await vi.advanceTimersByTimeAsync(10);
  await timedOut;
  expect(parent.postMessage).toHaveBeenCalledWith({ prism: "cancel", id: 1 }, "*", []);
  const controller = new AbortController();
  const cancelled = expect(
    client.request("slow", {}, { signal: controller.signal }),
  ).rejects.toThrow("取消");
  controller.abort();
  await cancelled;
  const changed = expect(client.agent.send({ text: "old" })).rejects.toMatchObject({
    code: "SESSION_CHANGED",
  });
  deliver({ prism: "context", context: { sessionId: "session-two", connected: true } });
  await changed;
  const closed = expect(client.agent.read()).rejects.toThrow("界面已关闭");
  client.close();
  await closed;
  await expect(client.agent.read()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("reports disconnection, requests resync after a replay gap and disposes subscriptions", async () => {
  const context = vi.fn();
  const agent = vi.fn();
  const plugin = vi.fn();
  const closeContext = client.onContext(context);
  const closeAgent = client.agent.subscribe(agent);
  const closePlugin = client.subscribe(plugin);
  const pending = expect(client.agent.read()).rejects.toMatchObject({
    code: "DISCONNECTED",
  });
  deliver({
    prism: "context",
    context: { sessionId: "session-one", connected: false },
  });
  await pending;
  await expect(client.agent.read()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  deliver({ prism: "context", context: { sessionId: "session-one", connected: true } });
  deliver({ prism: "resync" });
  expect(context).toHaveBeenCalledTimes(4);
  deliver({
    prism: "agent.event",
    agentEvent: { type: "task.state", sessionId: "session-one", running: true },
  });
  expect(agent).toHaveBeenCalledTimes(1);
  expect(plugin).not.toHaveBeenCalled();
  closeContext();
  closeAgent();
  closePlugin();
  deliver({ prism: "resync" });
  deliver({
    prism: "agent.event",
    agentEvent: { type: "task.state", sessionId: "session-one", running: false },
  });
  expect(context).toHaveBeenCalledTimes(4);
  expect(agent).toHaveBeenCalledTimes(1);
});

it("reuses requests, events and cancellation through the native page bridge", async () => {
  client.close();
  parent.postMessage.mockClear();
  const messages = new Set<(value: unknown) => void>();
  const send = vi.fn();
  Object.assign(window, {
    prismNativeApp: {
      send,
      subscribe: (listener: (value: unknown) => void) => {
        messages.add(listener);
        return () => messages.delete(listener);
      },
    },
  });
  const nativeDeliver = (message: unknown): void => {
    for (const listener of messages) listener(message);
  };
  client = new PluginClient();
  expect(send).toHaveBeenCalledWith({ prism: "ready" });
  expect(listeners.size).toBe(0);
  nativeDeliver({
    prism: "context",
    context: { sessionId: "native-session", connected: true, desktop: true },
  });
  const opened = client.app.open("https://app.notion.com/page");
  expect(send).toHaveBeenLastCalledWith({
    prism: "host.request",
    id: 1,
    method: "app.open",
    sessionId: "native-session",
    input: { url: "https://app.notion.com/page" },
  });
  nativeDeliver({ prism: "result", id: 1, result: { opened: true } });
  expect(await opened).toEqual({ opened: true });
  const controller = new AbortController();
  const edit = expect(
    client.app.insertText(
      "text",
      {
        token: "token",
        url: "https://app.notion.com/page",
        content: "old",
        selection: "old",
      },
      { signal: controller.signal },
    ),
  ).rejects.toThrow("取消");
  controller.abort();
  await edit;
  expect(send).toHaveBeenLastCalledWith({ prism: "cancel", id: 2 });
  const plugin = vi.fn();
  client.subscribe(plugin);
  nativeDeliver({
    prism: "event",
    event: {
      type: "plugin.event",
      plugin: "notion",
      name: "document.request",
      data: {},
    },
  });
  expect(plugin).toHaveBeenCalledOnce();
  client.close();
  expect(messages.size).toBe(0);
  expect(parent.postMessage).not.toHaveBeenCalled();
});
