import { PluginClient } from "@prism/plugin-sdk/client";
import "./style.css";

const client = new PluginClient();
const root = document.getElementById("root")!;
root.innerHTML =
  '<main class="notion-launch"><div class="notion-mark" aria-hidden="true">N</div><h1>Notion · Prism</h1><p>使用 Notion 原生网页。点击页面中的 AI 入口，让 Prism 带着当前页面与选区处理任务。</p><label>Notion 页面地址<input type="url" aria-label="Notion 页面地址" value="https://app.notion.com/" spellcheck="false"></label><button type="button">打开 Notion</button><p role="status"></p><p class="notion-note">首次打开请在 Notion 登录。每个窗口连接打开时的 Prism 会话，登录状态由本机保留。</p></main>';
const input = root.querySelector("input")!;
const button = root.querySelector("button")!;
const status = root.querySelector<HTMLElement>('[role="status"]')!;
let ready = false;
let busy = false;
client.onContext((context) => {
  ready = context.connected && context.sessionId !== null && context.desktop === true;
  button.disabled = !ready || busy;
  status.textContent =
    context.desktop !== true
      ? "请在 Prism 桌面端打开 Notion 原生网页。"
      : context.sessionId === null
        ? "先选择一个 Prism 会话。"
        : !context.connected
          ? "正在等待 Prism 连接…"
          : "已连接当前 Prism 会话";
});
button.addEventListener("click", () => {
  if (!ready || busy) return;
  busy = true;
  button.disabled = true;
  status.textContent = "正在打开 Notion…";
  void client.app
    .open(input.value)
    .then(() => {
      status.textContent = "Notion 已打开，点击原生 AI 入口即可使用 Prism。";
    })
    .catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      busy = false;
      button.disabled = !ready;
    });
});
window.addEventListener("pagehide", () => client.close(), { once: true });
