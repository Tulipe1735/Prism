import type { ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

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
    asChild?: boolean;
  };

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
