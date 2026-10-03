import { cn } from "@/lib/utils";

export interface CodeBlockProps {
  value: unknown;
  title?: string;
  tone?: "neutral" | "danger";
  className?: string;
}

export function CodeBlock({ value, title, tone = "neutral", className }: CodeBlockProps) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border text-sm",
        tone === "danger" ? "border-blocked/30 bg-blocked-bg/50" : "border-line bg-[#F7F7F7]",
        className,
      )}
    >
      {title ? (
        <div
          className={cn(
            "flex items-center gap-2 border-b px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em]",
            tone === "danger" ? "border-blocked/20 text-blocked" : "border-line text-ink-3",
          )}
        >
          <span
            aria-hidden
            className={cn("inline-block size-1.5", tone === "danger" ? "bg-blocked" : "bg-accent")}
          />
          {title}
        </div>
      ) : null}
      <pre className="max-h-80 overflow-auto p-3.5 font-mono text-xs leading-relaxed text-ink">
        <code>{text}</code>
      </pre>
    </div>
  );
}
