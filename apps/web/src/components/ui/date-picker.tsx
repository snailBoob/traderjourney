"use client";

import React, { useEffect, useId, useState } from "react";
import dynamic from "next/dynamic";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import { formatDateInput, parseDateInput } from "@/lib/date-input";

// The calendar is loaded on demand, not in every page's initial filter-bar bundle.
const Calendar = dynamic(() => import("./calendar").then((module) => module.Calendar), {
  loading: () => <div role="status" aria-label="Loading calendar" className="h-[300px]" />,
});

export function DatePicker({
  value,
  onValueChange,
  label,
  min,
  max,
  disabled,
  disabledDates = [],
  onValidityChange,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  disabledDates?: string[];
  /** Lets forms block submission while a typed draft is invalid. */
  onValidityChange?: (valid: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const errorId = useId();
  useEffect(() => {
    setDraft(value);
    setInvalid(false);
    onValidityChange?.(true);
  }, [value, onValidityChange]);
  const blocked = new Set(disabledDates);
  const allowed = (date: string) =>
    (!min || date >= min) && (!max || date <= max) && !blocked.has(date);
  const select = (date: string) => {
    setDraft(date);
    setInvalid(false);
    onValidityChange?.(true);
    onValueChange(date);
    setOpen(false);
  };
  const today = formatDateInput(new Date());
  const selected = parseDateInput(value);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <span className="relative block min-w-0">
          <div
            className="relative flex h-[38px] min-w-0 items-center rounded-md border border-input bg-background px-2 pr-10 tabular-nums box-border"
            aria-label={label}
          >
            <Input
              type="text"
              inputMode="numeric"
              value={draft}
              placeholder="YYYY-MM-DD"
              disabled={disabled}
              aria-label={label}
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errorId : undefined}
              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm tabular-nums shadow-none placeholder:text-sm focus-visible:ring-1"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const raw = event.target.value;
                if (!/^[\d-]*$/.test(raw)) return;
                let next = raw;
                if (/^\d{8}$/.test(raw))
                  next = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
                setDraft(next);
                setInvalid(false);
                onValidityChange?.(!next || Boolean(parseDateInput(next) && allowed(next)));
                if (parseDateInput(next) && allowed(next)) onValueChange(next);
                else if (!next) onValueChange("");
              }}
              onBlur={() =>
                setInvalid(Boolean(draft && (!parseDateInput(draft) || !allowed(draft))))
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setOpen(true);
                }
                if (event.key === "Escape") {
                  setDraft(value);
                  setInvalid(false);
                  onValidityChange?.(true);
                }
              }}
            />
          </div>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Choose ${label.toLowerCase()} date`}
              className="absolute top-0 right-0 flex h-[38px] w-[38px] items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <CalendarDays aria-hidden="true" className="size-4" />
            </button>
          </Popover.Trigger>
          {invalid && (
            <span
              id={errorId}
              role="alert"
              className="absolute left-0 top-full z-10 mt-1 block whitespace-nowrap text-xs text-destructive"
            >
              Enter a valid date (YYYY-MM-DD){max ? ` on or before ${max}` : ""}
              {min ? ` on or after ${min}` : ""}.
            </span>
          )}
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          aria-label={`${label} calendar`}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="journal-popup journal-menu-surface z-50 w-[296px] max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border bg-popover p-3 text-popover-foreground outline-none"
        >
          <Calendar
            mode="single"
            autoFocus
            selected={selected}
            defaultMonth={selected ?? parseDateInput(max ?? "") ?? new Date()}
            onSelect={(date) => select(date ? formatDateInput(date) : "")}
            disabled={(date) => !allowed(formatDateInput(date))}
          />
          <div className="mt-3 flex items-center justify-between border-t pt-2">
            <Button variant="ghost" size="sm" disabled={!draft} onClick={() => select("")}>
              Clear
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!allowed(today)}
              onClick={() => select(today)}
            >
              Today
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
