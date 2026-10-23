import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { twMerge } from "tailwind-merge";

export function Button({
  children,
  className = "",
  variant = "outline",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
}): JSX.Element {
  const styles = {
    primary: "border-ink bg-ink text-paper hover:border-[#504e48] hover:bg-[#504e48]",
    outline: "border-line bg-paper text-ink hover:border-[#d3d1cb] hover:bg-surface",
    ghost: "border-transparent text-muted hover:bg-ink/5 hover:text-ink",
  };
  return (
    <button
      type={type}
      className={twMerge(
        "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium tracking-[-0.01em] transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** One quiet section label. No numbering, no uppercase, no second language. */
export function SectionLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2 className="text-xs font-semibold tracking-[0.01em] text-muted">{children}</h2>
  );
}

export function PrismMark({ className = "" }: { className?: string }): JSX.Element {
  return (
    <img
      src="assets/prism-symbol-small.svg"
      alt=""
      aria-hidden="true"
      width={24}
      height={24}
      className={twMerge("block size-6 shrink-0", className)}
    />
  );
}

export function workspaceName(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? "工作区";
}

export const SCOPE_LABELS = {
  "read-only": "只读",
  "workspace-write": "工作区可写",
  "full-access": "完全访问",
} as const;
