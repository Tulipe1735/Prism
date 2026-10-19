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
    primary: "border-ink bg-ink text-paper hover:border-accent hover:bg-accent",
    outline: "border-line bg-transparent text-ink hover:border-ink hover:bg-surface",
    ghost: "border-transparent text-muted hover:bg-surface hover:text-ink",
  };
  return (
    <button
      type={type}
      className={twMerge(
        "inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-sm border px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        styles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function SectionLabel({
  number,
  children,
}: {
  number: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="eyebrow flex items-center gap-3">
      <span className="text-accent">{number}</span>
      {children}
    </div>
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
