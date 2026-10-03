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
        tone === "danger"
          ? "border-red-500/30 bg-red-500/5"
          : "border-border bg-muted/40",
        className,
      )}
    >
      {title ? (
        <div
          className={cn(
            "border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground",
            tone === "danger" ? "border-red-500/20" : "border-border",
          )}
        >
          {title}
        </div>
      ) : null}
      <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground/90">
        <code>{text}</code>
      </pre>
    </div>
  );
}
