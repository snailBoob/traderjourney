"use client";

import React, { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Clock3 } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";

const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function normalizeTime(value: string) {
  return VALID_TIME.test(value) ? value : "00:00";
}

export function TimePicker({
  value,
  onValueChange,
  label,
  disabled,
  inputRef,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const selectedTime = normalizeTime(value);
  const [hours, minutes] = normalizeTime(draft).split(":");

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (next: string) => {
    setDraft(next);
    if (VALID_TIME.test(next)) onValueChange(next);
  };

  const chooseTime = (next: string) => {
    commit(next);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setDraft(selectedTime);
        else if (!VALID_TIME.test(draft)) setDraft(value);
        setOpen(nextOpen);
      }}
    >
      <div className="relative min-w-0">
        <div className="journal-time-picker-frame relative flex h-9 items-center rounded-md border border-input bg-background px-2 pr-8 tabular-nums">
          <Input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={draft}
            placeholder="HH:mm"
            disabled={disabled}
            aria-label={label}
            className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm tabular-nums shadow-none placeholder:text-sm focus-visible:ring-1"
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            onChange={(event) => {
              const raw = event.target.value;
              if (!/^[\d:]*$/.test(raw)) return;
              const next = raw;
              setDraft(next);
              if (VALID_TIME.test(next)) onValueChange(next);
              else if (!next) onValueChange("");
            }}
            onBlur={() => {
              const digits = draft.replace(/:/g, "");
              const normalized = /^\d{3}$/.test(digits)
                ? `0${digits[0]}:${digits.slice(1)}`
                : /^\d{4}$/.test(digits)
                  ? `${digits.slice(0, 2)}:${digits.slice(2)}`
                  : draft;
              if (VALID_TIME.test(normalized)) {
                setDraft(normalized);
                onValueChange(normalized);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setDraft(value);
              if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
            }}
          />
        </div>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={`Choose ${label.toLowerCase()}`}
            title="Choose time"
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Clock3 aria-hidden="true" className="size-4" />
          </button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content
          aria-label={`${label} time picker`}
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="journal-popup journal-menu-surface z-50 w-[240px] rounded-xl border bg-popover p-3 text-popover-foreground shadow-md outline-none"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className="mb-2 text-center text-xs font-medium text-muted-foreground">Uren</div>
              <div className="max-h-[216px] overflow-y-auto rounded-md">
                {Array.from({ length: 24 }, (_, hour) => {
                  const item = String(hour).padStart(2, "0");
                  const active = item === hours;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={active}
                      onClick={() => chooseTime(`${item}:${minutes}`)}
                      className={`block h-9 w-full rounded-sm text-sm tabular-nums hover:bg-accent ${active ? "bg-primary text-primary-foreground" : ""}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="min-w-0 border-l pl-3">
              <div className="mb-2 text-center text-xs font-medium text-muted-foreground">
                Minuten
              </div>
              <div className="max-h-[216px] overflow-y-auto rounded-md">
                {Array.from({ length: 60 }, (_, minute) => {
                  const item = String(minute).padStart(2, "0");
                  const active = item === minutes;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={active}
                      onClick={() => chooseTime(`${hours}:${item}`)}
                      className={`block h-9 w-full rounded-sm text-sm tabular-nums hover:bg-accent ${active ? "bg-primary text-primary-foreground" : ""}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t pt-3">
            <span className="text-sm tabular-nums text-muted-foreground">
              {VALID_TIME.test(draft) ? draft : "Kies een tijd"}
            </span>
            <Button size="sm" onClick={() => setOpen(false)}>
              Gereed
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
