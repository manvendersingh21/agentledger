import type React from "react";
import { cn } from "@/lib/utils";

export interface EyebrowProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Render a small square marker before the label. */
  marker?: boolean;
}

export function Eyebrow({ className, marker = true, children, ...props }: EyebrowProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-accent",
        className,
      )}
      {...props}
    >
      {marker ? <span aria-hidden className="inline-block size-1.5 bg-accent" /> : null}
      {children}
    </span>
  );
}
