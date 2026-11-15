"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import * as Popover from "@radix-ui/react-popover";
import { CalendarClock } from "lucide-react";
import { Input } from "./input";
import { Button } from "./button";
import { formatDateInput, parseDateInput } from "@/lib/date-input";

const Calendar = dynamic(() => import("./calendar").then((module) => module.Calendar), {
  loading: () => <div role="status" aria-label="Loading calendar" className="h-[300px]" />,
});

function normalizeTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value) ? value : "00:00";
}

export function DateTimePicker({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [datePart = "", rawTime = ""] = value.split("T");
  const timePart = rawTime ? normalizeTime(rawTime.slice(0, 5)) : "";
  const [draftDate, setDraftDate] = useState(datePart);
  const [draftTime, setDraftTime] = useState(timePart);
  const selected = parseDateInput(draftDate);
  const [hours = "", minutes = ""] = draftTime.split(":");

  useEffect(() => {
    setDraftDate(datePart);
    setDraftTime(timePart);
  }, [datePart, timePart]);

  const commit = (date: string, time: string) => {
    setDraftDate(date);
    setDraftTime(time);
    if (date && parseDateInput(date) && /^\d{2}:\d{2}$/.test(time))
      onValueChange(`${date}T${time}`);
    else if (!date) onValueChange("");
  };

  const today = formatDateInput(new Date());

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setDraftDate(datePart);
          setDraftTime(timePart);
        }
        setOpen(nextOpen);
      }}
    >
      <Popover.Anchor asChild>
        <span className="relative block w-full min-w-0">
          <div
            className="relative flex h-9 min-w-0 items-center gap-0 rounded-md border border-input bg-background px-2 pr-8 tabular-nums"
            aria-label={label}
          >
            <Input
              type="text"
              inputMode="numeric"
              value={draftDate}
              placeholder="YYYY-MM-DD"
              disabled={disabled}
              aria-label={`${label} date`}
              className="h-7 w-[calc(10ch+1em)] min-w-0 flex-none border-0 bg-transparent px-0 text-sm tabular-nums shadow-none placeholder:text-sm focus-visible:ring-1"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const raw = event.target.value;
                if (!/^[\d-]*$/.test(raw)) return;
                const date = /^\d{8}$/.test(raw)
                  ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
                  : raw;
                setDraftDate(date);
                if (parseDateInput(date) && /^\d{2}:\d{2}$/.test(draftTime)) {
                  onValueChange(`${date}T${draftTime}`);
                } else if (!date) {
                  onValueChange("");
                }
              }}
            />
            <Input
              type="text"
              inputMode="numeric"
              value={draftTime}
              placeholder="HH:mm"
              disabled={disabled}
              aria-label={`${label} time`}
              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-sm tabular-nums shadow-none placeholder:text-sm focus-visible:ring-1"
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const raw = event.target.value;
                if (!/^[\d:]*$/.test(raw)) return;
                const time = raw;
                setDraftTime(time);
                if (
                  parseDateInput(draftDate) &&
                  /^\d{2}:[0-5]\d$/.test(time) &&
                  Number(time.slice(0, 2)) < 24
                ) {
                  onValueChange(`${draftDate}T${time}`);
                } else if (!time && parseDateInput(draftDate)) {
                  // Clearing the time must preserve the selected date in Add Trade.
                  onValueChange(`${draftDate}T`);
                } else if (!time && !draftDate) {
                  onValueChange("");
                }
              }}
              onBlur={() => {
                const digits = draftTime.replace(/:/g, "");
                const normalized = /^\d{3}$/.test(digits)
                  ? `0${digits[0]}:${digits.slice(1)}`
                  : /^\d{4}$/.test(digits)
                    ? `${digits.slice(0, 2)}:${digits.slice(2)}`
                    : draftTime;
                setDraftTime(normalized);
                if (
                  parseDateInput(draftDate) &&
                  /^\d{2}:[0-5]\d$/.test(normalized) &&
                  Number(normalized.slice(0, 2)) < 24
                )
                  onValueChange(`${draftDate}T${normalized}`);
              }}
            />
          </div>
          <Popover.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Choose ${label.toLowerCase()}`}
              tabIndex={-1}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <CalendarClock aria-hidden="true" className="size-4" />
            </button>
          </Popover.Trigger>
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          aria-label={`${label} date and time picker`}
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="journal-popup journal-menu-surface z-50 w-[min(520px,calc(100vw-24px))] max-w-[calc(100vw-24px)] rounded-xl border bg-popover p-3 text-popover-foreground shadow-md outline-none"
        >
          <div className="relative grid grid-cols-[minmax(0,1fr)_112px_112px] gap-3">
            <div className="min-w-0">
              <Calendar
                mode="single"
                autoFocus
                selected={selected ?? parseDateInput(draftDate)}
                defaultMonth={selected ?? parseDateInput(draftDate) ?? new Date()}
                onSelect={(date) => {
                  if (date) commit(formatDateInput(date), draftTime);
                }}
              />
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <Button variant="ghost" size="sm" onClick={() => commit("", draftTime)}>
                  Clear
                </Button>
                <Button variant="ghost" size="sm" onClick={() => commit(today, draftTime)}>
                  Today
                </Button>
              </div>
            </div>
            <div className="absolute inset-y-0 col-start-2 row-start-1 flex min-h-0 min-w-0 w-[112px] flex-col border-l pl-3">
              <div className="mb-2 shrink-0 text-center text-xs font-medium text-muted-foreground">
                Hour
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md">
                {Array.from({ length: 24 }, (_, hour) => {
                  const item = String(hour).padStart(2, "0");
                  const active = item === hours;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={active}
                      onClick={() => commit(draftDate, `${item}:${minutes}`)}
                      className={`block h-9 w-full rounded-sm text-sm tabular-nums hover:bg-accent ${active ? "bg-primary text-primary-foreground" : ""}`}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="absolute inset-y-0 col-start-3 row-start-1 flex min-h-0 min-w-0 w-[112px] flex-col border-l pl-3">
              <div className="mb-2 shrink-0 text-center text-xs font-medium text-muted-foreground">
                Minute
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-md">
                {Array.from({ length: 60 }, (_, minute) => {
                  const item = String(minute).padStart(2, "0");
                  const active = item === minutes;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={active}
                      onClick={() => commit(draftDate, `${hours}:${item}`)}
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
              {draftDate || "Choose date"} · {draftTime}
            </span>
            <Button size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
