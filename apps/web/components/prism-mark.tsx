import { cn } from "@/lib/cn";

export function PrismMark({ compact = false }: { compact?: boolean }) {
  return (
    <span
      aria-label="Prism"
      className={cn("inline-flex items-center gap-2.5", compact && "gap-1.5")}
    >
      <span
        aria-hidden
        className={cn(
          "relative block h-[1.9rem] w-[2.1rem]",
          compact && "h-[1.4rem] w-[1.55rem] origin-left scale-75",
        )}
      >
        <i className="absolute top-[0.2rem] left-[0.5rem] h-0.5 w-6 origin-left rotate-60 bg-current" />
        <i className="absolute top-[1.55rem] left-[1.3rem] h-0.5 w-6 origin-left rotate-180 bg-current" />
        <i className="absolute top-[1.6rem] left-[0.55rem] h-0.5 w-6 origin-left -rotate-60 bg-blue-600" />
      </span>
      <span
        className={cn(
          "flex flex-col font-mono text-lg leading-none font-bold tracking-[0.22em]",
          compact && "text-sm",
        )}
      >
        PRISM
        {!compact && (
          <small className="mt-1.5 text-[0.43rem] tracking-[0.17em] text-stone-500">
            VISUAL SWE HARNESS
          </small>
        )}
      </span>
    </span>
  );
}
