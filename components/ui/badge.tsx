import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xs px-2 py-[3px] text-[11px] font-semibold uppercase leading-none tracking-[0.08em]",
  {
    variants: {
      variant: {
        neutral: "bg-neutral-bg text-neutral",
        red: "bg-blocked-bg text-blocked",
        amber: "bg-waiting-bg text-waiting",
        emerald: "bg-executed-bg text-executed",
        sky: "bg-approved-bg text-approved",
        violet: "bg-duplicate-bg text-duplicate",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
