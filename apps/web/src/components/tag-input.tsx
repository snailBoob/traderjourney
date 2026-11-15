"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  suggestions: string[];
  placeholder: string;
  onChange: (value: string[]) => void;
  onFocus?: () => void;
  closeOnSelect?: boolean;
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ");

export function TagInput({
  value,
  suggestions,
  placeholder,
  onChange,
  onFocus,
  closeOnSelect = true,
}: TagInputProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const available = useMemo(() => {
    const lower = query.trim().toLocaleLowerCase();
    return suggestions.filter(
      (suggestion) =>
        !value.some(
          (selected) => selected.toLocaleLowerCase() === suggestion.toLocaleLowerCase(),
        ) &&
        (!lower || suggestion.toLocaleLowerCase().includes(lower)),
    );
  }, [query, suggestions, value]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const add = (raw: string) => {
    const next = normalize(raw);
    if (!next) return;
    if (value.some((item) => item.toLocaleLowerCase() === next.toLocaleLowerCase())) {
      setQuery("");
      if (closeOnSelect) setOpen(false);
      return;
    }
    onChange([...value, next]);
    setQuery("");
    setOpen(!closeOnSelect);
  };

  const remove = (index: number) => onChange(value.filter((_, itemIndex) => itemIndex !== index));

  return (
    <div ref={rootRef} className="relative">
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 text-sm shadow-sm transition-colors",
          open ? "border-ring ring-1 ring-ring" : "border-input",
        )}
        onClick={() => {
          setOpen(true);
          inputRef.current?.focus();
        }}
      >
        {value.map((item, index) => (
          <span
            key={`${item}-${index}`}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-sm"
          >
            <span className="truncate">{item}</span>
            <button
              type="button"
              aria-label={`Remove ${item}`}
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.stopPropagation();
                remove(index);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onFocus={() => {
            setOpen(true);
            onFocus?.();
          }}
          onBlur={() => {
            if (query.trim()) add(query);
            setOpen(false);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(query);
            } else if (event.key === "Backspace" && !query && value.length > 0) {
              remove(value.length - 1);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="min-w-[120px] flex-1 bg-transparent py-0.5 outline-none placeholder:text-muted-foreground"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border bg-card shadow-lg">
          {available.length > 0 ? (
            <div className="max-h-56 overflow-y-auto py-1">
              {available.map((suggestion, index) => (
                <button
                  key={suggestion}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted",
                    index === 0 && "bg-muted/50",
                  )}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(suggestion)}
                >
                  <span className="truncate">{suggestion}</span>
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              {query.trim() ? "Press Enter to add a new value" : "No previous values"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
