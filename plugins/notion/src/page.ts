import { PluginClient } from "@prism/plugin-sdk/client";
import { aiEntry, NotionPage, ROOT_ID } from "./document.ts";
import { NotionAiPanel } from "./panel.ts";
import "./page.css";

if (document.getElementById(ROOT_ID) === null) {
  const client = new PluginClient();
  const page = new NotionPage();
  const root = document.createElement("div");
  root.id = ROOT_ID;
  document.body.append(root);
  const panel = new NotionAiPanel(client, page, root);
  const fallback = document.createElement("button");
  fallback.type = "button";
  fallback.className = "prism-notion-entry";
  fallback.textContent = "✦ Prism AI";
  fallback.setAttribute("aria-label", "打开 Prism AI");
  root.append(fallback);
  const clientId = crypto.randomUUID();
  const controller = new AbortController();
  const stops: (() => void)[] = [];
  const captured = (event: Event): void => {
    if (aiEntry(event.target) !== null || event.target === fallback) {
      page.capture();
      event.preventDefault();
    } else if (
      event.target instanceof Element &&
      event.target.closest(`#${ROOT_ID}`) === null
    )
      page.clearSelection();
  };
  const open = (event: Event): void => {
    if (aiEntry(event.target) === null && event.target !== fallback) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    panel.show();
  };
  document.addEventListener("pointerdown", captured, true);
  document.addEventListener("click", open, true);
  const keyboard = (event: KeyboardEvent): void => {
    if (
      (event.key === "Enter" || event.key === " ") &&
      aiEntry(event.target) !== null
    ) {
      page.capture();
      event.preventDefault();
      event.stopImmediatePropagation();
      panel.show();
    }
  };
  document.addEventListener("keydown", keyboard, true);
  const selectionChanged = (): void => page.selectionChanged();
  document.addEventListener("selectionchange", selectionChanged);
  const updateEntry = (): void => {
    const native = Array.from(
      document.querySelectorAll(
        'button,[role="button"],a,[data-testid="notion-ai-button"],.notion-sidebar-ai-button',
      ),
    ).some(
      (element) =>
        aiEntry(element) !== null &&
        element.checkVisibility({ checkVisibilityCSS: true }),
    );
    fallback.hidden = native;
  };
  updateEntry();
  const observing = new MutationObserver(updateEntry);
  observing.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "class"],
  });
  stops.push(
    client.onContext((context) => {
      if (context.connected && context.sessionId !== null)
        void client
          .request(
            "document.ready",
            { clientId, url: location.href },
            { signal: controller.signal },
          )
          .catch((error: unknown) => {
            fallback.hidden = false;
            fallback.title = error instanceof Error ? error.message : String(error);
          });
    }),
  );
  const requests = new Map<string, AbortController>();
  const seen = new Set<string>();
  const remember = (id: string): void => {
    seen.add(id);
    if (seen.size > 256) seen.delete(seen.values().next().value!);
  };
  stops.push(
    client.subscribe((event) => {
      if (event.data === null || typeof event.data !== "object") return;
      const request = event.data as {
        id?: unknown;
        clientId?: unknown;
        kind?: unknown;
        input?: { revision?: unknown; text?: unknown };
      };
      if (request.clientId !== clientId || typeof request.id !== "string") return;
      const id = request.id;
      if (event.name === "document.cancel") {
        remember(id);
        requests.get(id)?.abort();
        return;
      }
      if (event.name !== "document.request" || seen.has(id) || requests.has(id)) return;
      remember(id);
      const operation = new AbortController();
      requests.set(id, operation);
      void Promise.resolve()
        .then(async () => {
          try {
            operation.signal.throwIfAborted();
            let doc;
            if (request.kind === "read") doc = await page.read();
            else if (
              request.kind === "apply" &&
              typeof request.input?.revision === "string" &&
              typeof request.input.text === "string"
            )
              doc = await page.apply(
                client,
                request.input.revision,
                request.input.text,
                operation.signal,
              );
            else throw new Error("不支持的页面操作。");
            await client.request(
              "document.reply",
              { id, clientId, document: doc },
              { signal: operation.signal },
            );
          } catch (error) {
            if (!operation.signal.aborted)
              await client
                .request(
                  "document.reply",
                  {
                    id,
                    clientId,
                    error: {
                      message: (error instanceof Error
                        ? error.message
                        : String(error)
                      ).slice(0, 2000),
                    },
                  },
                  { signal: operation.signal },
                )
                .catch(() => {});
          }
        })
        .finally(() => requests.delete(id));
    }),
  );
  window.addEventListener(
    "pagehide",
    () => {
      controller.abort();
      observing.disconnect();
      panel.close();
      for (const stop of stops) stop();
      for (const request of requests.values()) request.abort();
      document.removeEventListener("pointerdown", captured, true);
      document.removeEventListener("click", open, true);
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("selectionchange", selectionChanged);
      client.close();
      root.remove();
    },
    { once: true },
  );
}
