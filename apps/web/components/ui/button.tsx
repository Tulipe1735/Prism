import type { ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

/**
 * 按钮的样式变体（用 class-variance-authority 声明）。
 *
 * variant：primary（实心主按钮）/ secondary（描边次按钮）/ quiet（低调文本按钮）；
 * size：default（标准高度）/ compact（紧凑高度）。
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-[0.68rem] font-bold tracking-[0.06em] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:pointer-events-none disabled:opacity-55",
  {
    variants: {
      variant: {
        primary: "border border-blue-600 bg-blue-600 px-5 text-white hover:bg-blue-700",
        secondary:
          "border border-stone-500 bg-transparent px-4 text-stone-800 hover:bg-white/50",
        quiet: "px-2 text-stone-600 hover:text-stone-950",
      },
      size: {
        default: "min-h-10",
        compact: "min-h-8",
      },
    },
    defaultVariants: {
      size: "default",
      variant: "primary",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** 为 true 时渲染为可组合的 Slot（把样式透传给任意子元素）。 */
    asChild?: boolean;
  };

/**
 * Field Desk 按钮：基于变体样式渲染原生 button（或 Slot）。
 */
export function Button({
  asChild = false,
  className,
  size,
  variant,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ className, size, variant }))}
      {...props}
    />
  );
}
