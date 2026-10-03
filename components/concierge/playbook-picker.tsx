"use client";

import { PLAYBOOKS, type Playbook } from "@/lib/agent/playbooks";
import { cn } from "@/lib/utils";

export interface PlaybookPickerProps {
  /** Called with the playbook's example prompt when a tile is clicked. */
  onPick: (prompt: string) => void;
  /** Defaults to all PLAYBOOKS. */
  playbooks?: readonly Playbook[];
  disabled?: boolean;
  className?: string;
}

/** Grid of playbook tiles for the concierge empty state. */
export function PlaybookPicker({ onPick, playbooks = PLAYBOOKS, disabled = false, className }: PlaybookPickerProps) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {playbooks.map((playbook) => (
        <button
          key={playbook.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(playbook.examplePrompt)}
          className="group rounded-[6px] border border-line bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-accent-wash disabled:opacity-50"
        >
          <span className="flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              {playbook.emoji}
            </span>
            <span className="text-sm font-medium text-ink group-hover:text-accent">{playbook.title}</span>
          </span>
          <span className="mt-2 block text-[13px] leading-snug text-ink-2">“{playbook.examplePrompt}”</span>
        </button>
      ))}
    </div>
  );
}
