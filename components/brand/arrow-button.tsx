import type React from "react";
import Link from "next/link";
import { ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ArrowButtonProps {
  children: React.ReactNode;
  href?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
  variant?: "primary" | "secondary" | "inverse";
  size?: "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  className?: string;
  /** Override the arrow icon. */
  icon?: React.ReactNode;
  /** Open href in a new tab. */
  external?: boolean;
  "aria-label"?: string;
}

const LABEL = {
  primary: "bg-accent text-white group-hover:bg-accent-hover",
  secondary: "bg-surface text-ink border border-line group-hover:border-ink-3",
  inverse: "bg-inverse text-white group-hover:bg-[#1f1f1f]",
} as const;

const TILE = {
  primary: "bg-surface text-ink border border-line group-hover:border-ink-3",
  secondary: "bg-surface text-accent border border-line group-hover:border-ink-3",
  inverse: "bg-surface text-ink border border-line group-hover:border-ink-3",
} as const;

const HEIGHT = {
  md: { label: "h-10 px-4 text-sm", tile: "size-10" },
  lg: { label: "h-12 px-5 text-[15px]", tile: "size-12" },
} as const;

/**
 * Solid label button + square arrow tile, rendered as a pair.
 * Renders a next/link when `href` is set, otherwise a <button>.
 */
export function ArrowButton({
  children,
  href,
  onClick,
  variant = "primary",
  size = "lg",
  disabled = false,
  type = "button",
  className,
  icon,
  external = false,
  "aria-label": ariaLabel,
}: ArrowButtonProps) {
  const h = HEIGHT[size];
  const inner = (
    <>
      <span
        className={cn(
          "inline-flex items-center rounded-sm font-medium tracking-[-0.01em] transition-colors duration-200",
          h.label,
          LABEL[variant],
        )}
      >
        {children}
      </span>
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm transition-colors duration-200",
          h.tile,
          TILE[variant],
        )}
      >
        <span className="transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:translate-y-0.5">
          {icon ?? <ArrowDownRight className="size-4" strokeWidth={2} />}
        </span>
      </span>
    </>
  );

  const base = cn(
    "group inline-flex items-stretch gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
    disabled && "pointer-events-none opacity-50",
    className,
  );

  if (href && !disabled) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className={base}
        aria-label={ariaLabel}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={base}
      aria-label={ariaLabel}
    >
      {inner}
    </button>
  );
}
