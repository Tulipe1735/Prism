import type { JSX } from "react";
import type {
  DesktopSetupApi,
  DesktopSetupState,
} from "../electron/desktop-contract.ts";
import { ArrowUpRight, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, PrismMark, SectionLabel } from "./components.tsx";

declare global {
  interface Window {
    prismSetup: DesktopSetupApi;
  }
}

function Startup(): JSX.Element {
  const [state, setState] = useState<DesktopSetupState>({
    phase: "checking",
    distributions: [],
    selected: "",
    mode: "native",
    message: "正在检查运行环境…",
    detail: "",
  });
  const [mode, setMode] = useState<"native" | "wsl">("native");
  const [distribution, setDistribution] = useState("");
  const [browser, setBrowser] = useState(true);
  const busy =
    state.phase === "checking" ||
    state.phase === "preparing" ||
    state.phase === "starting";
  useEffect(() => {
    let active = true;
    const receive = (next: DesktopSetupState): void => {
      if (active) {
        setState(next);
        setDistribution(next.selected);
        setMode(next.mode);
      }
    };
    const stop = window.prismSetup.subscribe(receive);
    void window.prismSetup.read().then(receive);
    return () => {
      active = false;
      stop();
    };
  }, []);
  return (
    <main className="flex min-h-dvh items-center justify-center px-8 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-12 flex items-center gap-3">
          <PrismMark />
          <span className="text-3xl font-semibold tracking-tighter">Prism.</span>
        </div>
        <SectionLabel>开始工作</SectionLabel>
        <h1 className="mt-6 text-[32px] leading-[1.2] font-semibold tracking-[-0.03em]">
          {state.message}
        </h1>
        <p className="mt-4 text-sm leading-7 text-muted">
          可以直接在 Windows 中运行，也可以选择 WSL 开发环境。
          会话与设置保存在所选环境的用户目录。
        </p>
        <form
          className="mt-8 space-y-5 border-y py-6"
          onSubmit={(event) => {
            event.preventDefault();
            void window.prismSetup.prepare(
              mode === "native"
                ? { mode, installBrowser: browser }
                : { mode, distribution, installBrowser: browser },
            );
          }}
        >
          <label className="block text-[13px] font-medium">
            运行环境
            <select
              id="runtime-mode"
              className="field mt-2 text-sm"
              value={mode}
              disabled={busy}
              onChange={(event) => {
                setMode(event.target.value === "wsl" ? "wsl" : "native");
                if (distribution === "") setDistribution(state.distributions[0] ?? "");
              }}
            >
              <option value="native">Windows</option>
              <option value="wsl">WSL</option>
            </select>
          </label>
          {mode === "wsl" && state.distributions.length > 0 ? (
            <label className="block text-[13px] font-medium">
              WSL 发行版
              <select
                id="distribution"
                value={distribution}
                disabled={busy}
                onChange={(event) => setDistribution(event.target.value)}
                className="field mt-2 text-sm"
              >
                {state.distributions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {mode === "wsl" && state.distributions.length === 0 && !busy ? (
            <p className="text-sm leading-7">
              未找到 WSL 发行版。可以直接使用 Windows，或先安装并启动 WSL 后重新检查。
            </p>
          ) : null}
          <label className="flex items-start gap-3 text-[13px] leading-6 text-muted">
            <input
              type="checkbox"
              checked={browser}
              disabled={busy}
              onChange={(event) => setBrowser(event.target.checked)}
              className="mt-1.5 accent-accent"
            />
            <span>
              同时准备 Chromium 浏览器
              <span className="block text-[13px] text-muted">
                首次准备需要联网。也可以稍后通过工作台菜单安装浏览器。
              </span>
            </span>
          </label>
          <Button
            id="prepare"
            type="submit"
            variant="primary"
            disabled={busy || (mode === "wsl" && distribution === "")}
            className="w-full justify-between"
          >
            {busy ? "正在准备…" : state.phase === "error" ? "重试" : "准备并开始"}
            {busy ? (
              <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />
            ) : (
              <ArrowUpRight size={15} aria-hidden="true" />
            )}
          </Button>
        </form>
        {mode === "wsl" && state.distributions.length === 0 && !busy ? (
          <div className="mt-4 flex gap-3">
            <Button onClick={() => void window.prismSetup.openWslGuide()}>
              查看 WSL 安装说明
            </Button>
            <Button
              onClick={() =>
                void window.prismSetup.prepare({
                  mode: "wsl",
                  distribution: "",
                  installBrowser: browser,
                })
              }
            >
              重新检查 WSL
            </Button>
          </div>
        ) : null}
        {state.phase === "error" ? (
          <p
            role="alert"
            className="mt-5 flex items-center gap-2 text-[13px] text-accent"
          >
            <TriangleAlert size={14} />
            准备未完成。检查下面的详情后可以重试。
          </p>
        ) : null}
        {state.detail === "" ? null : (
          <pre
            role="log"
            aria-label="准备日志"
            className="mt-5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-surface p-4 font-mono text-xs leading-6 text-muted"
          >
            {state.detail}
          </pre>
        )}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Startup />);
