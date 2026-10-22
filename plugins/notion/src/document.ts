import type { WebAppEditGuard } from "@prism/plugin-sdk";
import type { PluginClient } from "@prism/plugin-sdk/client";
import type { NotionDocument } from "./protocol.ts";

export const ROOT_ID = "prism-notion-root";

function visibleText(): string {
  const root =
    document.querySelector(
      ".notion-page-content,[data-testid='notion-page-content'],main,[role='main']",
    ) ?? document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const text: string[] = [];
  let size = 0;
  let node = walker.nextNode();
  while (node !== null && size < 30_000) {
    const parent = node.parentElement;
    if (
      parent !== null &&
      !parent.closest(
        `#${ROOT_ID},script,style,noscript,input,textarea,[aria-hidden='true']`,
      ) &&
      parent.checkVisibility({ checkVisibilityCSS: true })
    ) {
      const value = node.textContent?.trim() ?? "";
      if (value !== "") {
        text.push(value);
        size += value.length + 1;
      }
    }
    node = walker.nextNode();
  }
  return text.join("\n").slice(0, 30_000);
}

async function revision(content: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return Array.from(new Uint8Array(hash), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

/** Only a cursor/selection captured in an actual editable may become a write target. */
export class NotionPage {
  private target: {
    element: HTMLElement;
    range: Range;
    guard: WebAppEditGuard;
  } | null = null;

  capture(): void {
    const selection = getSelection();
    if (selection === null || selection.rangeCount !== 1) {
      this.target = null;
      return;
    }
    const range = selection.getRangeAt(0);
    const parent =
      range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? (range.commonAncestorContainer as Element)
        : range.commonAncestorContainer.parentElement;
    const element = parent?.closest<HTMLElement>(
      '[contenteditable="true"],[contenteditable="plaintext-only"]',
    );
    if (
      element === undefined ||
      element === null ||
      !element.isContentEditable ||
      element.closest(`#${ROOT_ID}`) !== null ||
      range.toString().length > 50_000 ||
      (element.textContent?.length ?? 0) > 200_000
    ) {
      this.target = null;
      return;
    }
    const token = crypto.randomUUID();
    element.dataset.prismEditToken = token;
    this.target = {
      element,
      range: range.cloneRange(),
      guard: {
        token,
        url: location.href,
        content: element.textContent ?? "",
        selection: range.toString(),
      },
    };
  }

  private editable(): boolean {
    const target = this.target;
    return (
      target !== null &&
      target.element.isConnected &&
      target.element.isContentEditable &&
      location.href === target.guard.url &&
      target.element.textContent === target.guard.content &&
      target.element.contains(target.range.commonAncestorContainer) &&
      target.range.toString() === target.guard.selection
    );
  }

  selectionChanged(): void {
    const active = document.activeElement;
    if (
      this.target === null ||
      !(active instanceof HTMLElement) ||
      !active.isContentEditable ||
      active.closest(`#${ROOT_ID}`) !== null
    )
      return;
    const selection = getSelection();
    const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
    const captured = this.target.range;
    if (
      range === null ||
      range.startContainer !== captured.startContainer ||
      range.startOffset !== captured.startOffset ||
      range.endContainer !== captured.endContainer ||
      range.endOffset !== captured.endOffset
    )
      this.target = null;
  }

  clearSelection(): void {
    this.target = null;
  }

  async read(): Promise<NotionDocument> {
    const content = visibleText();
    const editable = this.editable();
    const selection = editable ? this.target!.guard.selection : "";
    return {
      url: location.href,
      title: document.title.slice(0, 1000),
      content,
      selection,
      editable,
      revision: await revision(
        JSON.stringify([
          performance.timeOrigin,
          location.href,
          content,
          selection,
          editable,
          this.target?.guard.content,
        ]),
      ),
    };
  }

  async apply(
    client: PluginClient,
    expected: string,
    text: string,
    signal: AbortSignal,
  ): Promise<NotionDocument> {
    signal.throwIfAborted();
    const current = await this.read();
    signal.throwIfAborted();
    if (current.revision !== expected)
      throw new Error("页面或选区已经改变，请重新读取后再修改。");
    if (!current.editable || this.target === null)
      throw new Error("先在 Notion 页面中放置光标或选中文字，再点击 AI 入口。");
    const target = this.target;
    target.element.focus({ preventScroll: true });
    const selection = getSelection();
    if (selection === null) throw new Error("无法恢复页面选区。");
    selection.removeAllRanges();
    selection.addRange(target.range.cloneRange());
    await client.app.insertText(text, target.guard, { signal });
    if (
      target.element.textContent === target.guard.content &&
      text !== target.guard.selection
    )
      throw new Error("Notion 尚未确认文字修改，请检查页面后再继续。");
    this.capture();
    return this.read();
  }
}

export function aiEntry(target: EventTarget | null): Element | null {
  if (!(target instanceof Element) || target.closest(`#${ROOT_ID}`) !== null)
    return null;
  const element = target.closest(
    'button,[role="button"],a,[data-testid="notion-ai-button"],[data-testid="notion-ai-chat-button"],.notion-sidebar-ai-button',
  );
  if (element === null) return null;
  if (
    element.matches(
      '[data-testid="notion-ai-button"],[data-testid="notion-ai-chat-button"],.notion-sidebar-ai-button',
    )
  )
    return element;
  const label = (
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    element.textContent ??
    ""
  ).trim();
  return /^(?:(?:open|ask|chat with|new chat with)\s+)?notion\s+ai(?:\s*(?:chat|聊天|对话))?$|^(?:ask ai|询问\s*(?:notion\s*)?ai|问问\s*(?:notion\s*)?ai|打开\s*(?:notion\s*)?ai)$/i.test(
    label,
  )
    ? element
    : null;
}
