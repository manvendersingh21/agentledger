"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "p" | "span" | "div";

export interface ScatterHeadingProps {
  text: string;
  as?: HeadingTag;
  /** Words (case-insensitive, punctuation ignored) rendered in the accent colour. */
  accentWords?: string[];
  className?: string;
  /** Class applied to accent words. Defaults to `text-accent`. */
  accentClassName?: string;
  /** Delay before the animation starts once in view (ms). */
  delay?: number;
  /** Only animate the first time it scrolls into view. Default true. */
  once?: boolean;
  id?: string;
}

/** Deterministic pseudo-random in [-1, 1] so SSR and client agree. */
function rand(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function ScatterHeading({
  text,
  as = "h2",
  accentWords = [],
  className,
  accentClassName = "text-accent",
  delay = 0,
  once = true,
  id,
}: ScatterHeadingProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) io.disconnect();
          } else if (!once) {
            setVisible(false);
          }
        }
      },
      { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  const accentSet = new Set(accentWords.map(normalize));
  const words = text.split(/(\s+)/);
  let letterIndex = 0;
  const totalLetters = text.replace(/\s+/g, "").length || 1;

  const Tag = as as React.ElementType;

  return (
    <Tag
      ref={ref}
      id={id}
      aria-label={text}
      className={cn(
        "font-display font-semibold tracking-[-0.045em] leading-[0.95] text-ink",
        className,
      )}
    >
      {words.map((word, wi) => {
        if (/^\s+$/.test(word)) return <span key={`s${wi}`}> </span>;
        const isAccent = accentSet.has(normalize(word));
        return (
          <span
            key={`w${wi}`}
            aria-hidden
            className={cn("inline-block whitespace-nowrap", isAccent && accentClassName)}
          >
            {Array.from(word).map((ch, ci) => {
              const i = letterIndex++;
              const dx = rand(i + 1) * 0.9;
              const dy = rand(i + 101) * 0.7;
              const rot = rand(i + 211) * 24;
              const stagger = Math.round((i / totalLetters) * 380 + Math.abs(rand(i + 307)) * 220);
              const style: React.CSSProperties = visible
                ? {
                    transform: "translate3d(0,0,0) rotate(0deg)",
                    opacity: 1,
                    filter: "blur(0px)",
                    transitionDelay: `${delay + stagger}ms`,
                  }
                : {
                    transform: `translate3d(${dx}em, ${dy}em, 0) rotate(${rot}deg)`,
                    opacity: 0,
                    filter: "blur(2px)",
                  };
              return (
                <span key={ci} className="scatter-letter" style={style}>
                  {ch}
                </span>
              );
            })}
          </span>
        );
      })}
    </Tag>
  );
}
