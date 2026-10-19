import type { JSX } from "react";
import type { UpdateState } from "../electron/desktop-contract.ts";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowDownToLine,
  ChevronUp,
  LogIn,
  LogOut,
  RefreshCw,
  Settings2,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { VERSION } from "../../shared/version.ts";
import { useAccount } from "./account.tsx";

export function AccountMenu({
  collapsed,
  taskRunning,
  onSettings,
  onError,
}: {
  collapsed: boolean;
  taskRunning: boolean;
  onSettings: () => void;
  onError: (message: string) => void;
}): JSX.Element {
  const account = useAccount();
  const [update, setUpdate] = useState<UpdateState>({
    phase: "idle",
    version: VERSION,
  });
  const desktop = typeof window === "undefined" ? undefined : window.prismDesktop;
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const receive = (state: UpdateState): void => {
      if (active) setUpdate(state);
    };
    const unsubscribe = desktop.updates.subscribe(receive);
    void desktop.updates
      .read()
      .then(receive)
      .catch(() => {
        receive({
          phase: "error",
          version: desktop.version,
          message: "无法读取更新状态，请重试。",
        });
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktop]);
  const signedIn = account?.status === "signed-in";
  const loading = account?.status === "loading";
  const name = signedIn ? (account.name ?? "Prism 账户") : "登录 Prism";
  const updateLabel = {
    idle: "检查更新",
    unsupported: "检查更新",
    checking: "正在检查更新…",
    current: "已是最新版本",
    available: `下载 v${update.latestVersion}`,
    downloading: `正在下载 ${update.percent ?? 0}%`,
    downloaded: "重启并安装更新",
    error: "重新检查更新",
  }[update.phase];

  async function updateApp(): Promise<void> {
    if (!desktop) return;
    try {
      if (update.phase === "downloaded") await desktop.updates.install();
      else if (update.phase === "available") await desktop.updates.download();
      else await desktop.updates.check();
    } catch (error) {
      onError(error instanceof Error ? error.message : "更新失败，请重试。");
    }
  }

  const item =
    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[13px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface";
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className={`flex min-h-10 items-center rounded-md text-left outline-none hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-accent ${collapsed ? "mx-auto size-10 justify-center" : "w-full gap-3 px-2 py-2"}`}
        aria-label="账户与更新"
        data-account-state={account?.status ?? "unavailable"}
        title={collapsed ? name : undefined}
      >
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-surface">
          {signedIn && account.imageUrl ? (
            <img src={account.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <UserRound size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{name}</span>
              <span className="mt-0.5 block truncate text-xs text-muted">
                {signedIn ? account.email : loading ? "正在连接账号…" : "本地工作台"}
              </span>
            </span>
            <ChevronUp size={13} aria-hidden="true" className="text-muted" />
          </>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={10}
          collisionPadding={8}
          className="z-50 w-64 rounded-lg border bg-paper p-1.5 text-ink shadow-lg shadow-ink/5"
        >
          <DropdownMenu.Label className="px-3 py-3">
            <span className="block truncate text-[13px] font-semibold">
              {signedIn ? name : "Prism"}
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {signedIn ? account.email : "你的工作，你的空间。"}
            </span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          {signedIn ? (
            <DropdownMenu.Item className={item} onSelect={() => account.profile()}>
              <UserRound size={15} aria-hidden="true" />
              个人信息
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              className={item}
              disabled={!account || loading}
              onSelect={() => account?.signIn()}
            >
              <LogIn size={15} aria-hidden="true" />
              {loading ? "正在连接账号…" : "登录 / 注册"}
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={item} onSelect={onSettings}>
            <Settings2 size={15} aria-hidden="true" />
            工作台设置
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={item}
            disabled={
              !desktop ||
              update.phase === "unsupported" ||
              update.phase === "checking" ||
              update.phase === "downloading" ||
              (update.phase === "downloaded" && taskRunning)
            }
            onSelect={(event) => {
              event.preventDefault();
              void updateApp();
            }}
          >
            {update.phase === "available" || update.phase === "downloaded" ? (
              <ArrowDownToLine size={15} aria-hidden="true" />
            ) : (
              <RefreshCw
                size={15}
                aria-hidden="true"
                className={update.phase === "checking" ? "animate-spin" : ""}
              />
            )}
            {updateLabel}
          </DropdownMenu.Item>
          {update.message ? (
            <p role="status" className="px-3 py-2 text-xs leading-5 text-accent">
              {update.message}
            </p>
          ) : null}
          {update.phase === "downloaded" && taskRunning ? (
            <p className="px-3 py-2 text-xs leading-5 text-muted">
              任务完成后即可安装。
            </p>
          ) : null}
          {signedIn ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <DropdownMenu.Item
                className={item}
                onSelect={() => {
                  void account.signOut().catch(() => onError("退出登录失败，请重试。"));
                }}
              >
                <LogOut size={15} aria-hidden="true" />
                退出登录
              </DropdownMenu.Item>
            </>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <div className="px-3 py-1.5 text-[11px] tabular-nums text-muted">
            Prism v{update.version}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
