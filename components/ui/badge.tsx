import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
  {
    variants: {
      variant: {
        neutral:
          "border-border bg-muted text-muted-foreground",
        red: "border-red-500/30 bg-red-500/10 text-red-400",
        amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        sky: "border-sky-500/30 bg-sky-500/10 text-sky-400",
        violet: "border-violet-500/30 bg-violet-500/10 text-violet-400",
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
