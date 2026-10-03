import { cn } from "@/lib/utils";

export interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  className?: string;
  /** "inverse" renders a black stat block with white text. */
  tone?: "default" | "inverse";
}

export function MetricCard({ label, value, hint, className, tone = "default" }: MetricCardProps) {
  const inverse = tone === "inverse";
  return (
    <div
      className={cn(
        "flex min-h-[148px] flex-col justify-between rounded-md border p-5 md:p-6",
        inverse ? "border-inverse bg-inverse text-white" : "border-line bg-surface text-ink",
        className,
      )}
    >
      <p
        className={cn(
          "text-[11px] font-semibold uppercase tracking-[0.14em]",
          inverse ? "text-white/60" : "text-ink-3",
        )}
      >
        {label}
      </p>
      <div>
        <p
          className={cn(
            "mt-6 font-display font-semibold tabular-nums leading-[0.95] tracking-[-0.045em]",
            inverse ? "text-[44px] md:text-[56px]" : "text-[40px] md:text-[44px]",
          )}
        >
          {value}
        </p>
        {hint ? (
          <p className={cn("mt-2 text-[13px]", inverse ? "text-white/60" : "text-ink-3")}>{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
