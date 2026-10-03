"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type LocalTimeMode = "time" | "datetime";

export interface LocalTimeProps {
  iso: string;
  mode?: LocalTimeMode;
  className?: string;
}

function formatIso(iso: string, mode: LocalTimeMode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  if (mode === "time") {
    return date.toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function LocalTime({ iso, mode = "time", className }: LocalTimeProps) {
  const label = useSyncExternalStore(
    () => () => {},
    () => formatIso(iso, mode),
    () => "",
  );

  return (
    <time dateTime={iso} suppressHydrationWarning className={cn(className)}>
      {label || "\u00a0"}
    </time>
  );
}

export function LocalDateTime({ iso, className }: Omit<LocalTimeProps, "mode">) {
  return <LocalTime iso={iso} mode="datetime" className={className} />;
}
