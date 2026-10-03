import type React from "react";
import { cn } from "@/lib/utils";

/** 4x4 pixel-cluster mark; 1 = filled accent, 2 = soft accent, 0 = empty. */
const MARK: ReadonlyArray<ReadonlyArray<0 | 1 | 2>> = [
  [0, 1, 1, 0],
  [1, 2, 1, 1],
  [1, 1, 2, 1],
  [0, 1, 1, 0],
];

export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Hide the "AgentLedger" text and show only the mark. */
  markOnly?: boolean;
  /** Visual size. */
  size?: "sm" | "md" | "lg";
  /** Render on dark (inverse) surfaces. */
  inverse?: boolean;
}

const SIZES = {
  sm: { cell: 3, gap: 1, text: "text-[15px]" },
  md: { cell: 4, gap: 1, text: "text-[17px]" },
  lg: { cell: 6, gap: 1.5, text: "text-2xl" },
} as const;

export function PixelMark({
  size = "md",
  className,
}: {
  size?: WordmarkProps["size"];
  className?: string;
}) {
  const s = SIZES[size ?? "md"];
  const dim = s.cell * 4 + s.gap * 3;
  return (
    <svg
      aria-hidden
      width={dim}
      height={dim}
      viewBox={`0 0 ${dim} ${dim}`}
      className={cn("shrink-0", className)}
      shapeRendering="crispEdges"
    >
      {MARK.flatMap((row, y) =>
        row.map((v, x) =>
          v === 0 ? null : (
            <rect
              key={`${x}-${y}`}
              x={x * (s.cell + s.gap)}
              y={y * (s.cell + s.gap)}
              width={s.cell}
              height={s.cell}
              fill={v === 1 ? "var(--accent)" : "var(--accent-soft)"}
            />
          ),
        ),
      )}
    </svg>
  );
}

export function Wordmark({
  markOnly = false,
  size = "md",
  inverse = false,
  className,
  ...props
}: WordmarkProps) {
  const s = SIZES[size];
  return (
    <span
      className={cn("inline-flex items-center gap-2.5", className)}
      aria-label={markOnly ? "AgentLedger" : undefined}
      {...props}
    >
      <PixelMark size={size} />
      {markOnly ? null : (
        <span
          className={cn(
            "font-display font-semibold tracking-[-0.03em] leading-none",
            s.text,
            inverse ? "text-white" : "text-ink",
          )}
        >
          AgentLedger
        </span>
      )}
    </span>
  );
}
