"use client";

import type { MouseEventHandler } from "react";
import { HoverHint } from "@/components/ui/tooltip";

export interface RoutineDayCellProps {
  date: string;
  completed: number;
  total: number;
  score: number | null;
  selected?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

export function RoutineDayCell({
  date,
  completed,
  total,
  score,
  selected = false,
  onClick,
  className,
}: RoutineDayCellProps) {
  return (
    <HoverHint heading={date} content={`${completed} of ${total} routines completed`}>
      <button
        type="button"
        aria-label={`${date}: ${completed}/${total} complete`}
        onClick={onClick}
        className={`min-h-7 min-w-7 rounded border ${selected ? "border-foreground" : "border-transparent"} ${className ?? ""}`}
        style={{
          background:
            score === null
              ? "var(--muted)"
              : `color-mix(in srgb, var(--brand) ${15 + score * 75}%, var(--card))`,
        }}
      />
    </HoverHint>
  );
}
