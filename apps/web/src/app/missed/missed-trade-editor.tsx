"use client";

import { Field, fieldClass } from "@/components/filter-fields";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OptionSelect } from "@/components/ui/option-select";
import { HelpHint } from "@/components/ui/tooltip";
import { postJson } from "@/lib/use-api";
import { useEffect, useId, useRef, useState } from "react";
import { dateKey, outcomeLabel } from "./format";
import { OUTCOMES, type Missed, type Outcome, type Playbook, type RuleCheck } from "./types";
const blank = () => ({
  symbol: "",
  observedAt: new Date().toISOString().slice(0, 10),
  playbookId: "",
  outcome: "" as Outcome | "",
  tags: [] as string[],
  tradingViewUrl: "",
  notes: "",
  ruleChecks: [] as RuleCheck[],
});
export function MissedTradeEditor({
  trade,
  focusTarget,
  books,
  tagSuggestions,
  failure,
  setFailure,
  onClose,
  onSaved,
}: {
  trade?: Missed;
  focusTarget: "note" | "snapshot" | null;
  books?: { playbooks: Playbook[] } | null;
  tagSuggestions: string[];
  failure: string;
  setFailure: (message: string) => void;
  onClose: () => void;
  onSaved: (id: string | null, entry: { symbol: string; observedAt: string }) => void;
}) {
  const editing = trade?.id ?? null;
  const [draft, setDraft] = useState<ReturnType<typeof blank>>(() =>
    trade
      ? {
          symbol: trade.symbol,
          observedAt: dateKey(trade.observedAt),
          playbookId: trade.playbookId ?? "",
          outcome: trade.outcome ?? "",
          tags: trade.tags,
          tradingViewUrl: trade.tradingViewUrl ?? "",
          notes: trade.notes,
          ruleChecks: trade.ruleChecks,
        }
      : blank(),
  );
  const [busy, setBusy] = useState(false);
  const snapshotUrlRef = useRef<HTMLInputElement>(null);
  const noteEditorRef = useRef<RichEditorHandle>(null);
  const noteEditorId = useId();
  const open = true;
  const setOpen = (next: boolean) => {
    if (!next) onClose();
  };
  useEffect(() => {
    if (!open || !focusTarget) return;
    const frame = requestAnimationFrame(() => {
      if (focusTarget === "snapshot") snapshotUrlRef.current?.focus();
      else noteEditorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, focusTarget, editing]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add missed trade</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Symbol">
            <input
              className={fieldClass}
              placeholder="BTCUSDT, ETHBTC..."
              required
              value={draft.symbol}
              onChange={(event) => setDraft({ ...draft, symbol: event.target.value.toUpperCase() })}
            />
          </Field>
          <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              Strategy
              <HelpHint heading="Strategy">
                {draft.playbookId
                  ? books?.playbooks.find((book) => book.id === draft.playbookId)?.description ||
                    "No strategy description available."
                  : "Select the Strategy that applied to this missed trade."}
              </HelpHint>
            </span>
            <OptionSelect
              className={fieldClass}
              value={draft.playbookId}
              onValueChange={(next) => {
                const book = books?.playbooks.find((item) => item.id === next);
                setDraft({
                  ...draft,
                  playbookId: next,
                  ruleChecks: (book?.rules ?? []).map((rule) => ({ rule, followed: null })),
                });
              }}
            >
              <option value="">No strategy</option>
              {books?.playbooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name}
                </option>
              ))}
            </OptionSelect>
          </div>
          <Field label="Observation date">
            <DatePicker
              value={draft.observedAt}
              onValueChange={(value) => setDraft({ ...draft, observedAt: value })}
              label="Observation date"
            />
          </Field>
          <Field label="Outcome">
            <OptionSelect
              className={fieldClass}
              value={draft.outcome}
              onValueChange={(next) => setDraft({ ...draft, outcome: next as Outcome | "" })}
            >
              <option value="">Select outcome</option>
              {OUTCOMES.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcomeLabel(outcome)}
                </option>
              ))}
            </OptionSelect>
          </Field>
        </div>

        <div className="grid gap-1 text-xs text-muted-foreground">
          <span>Tags</span>
          <TagInput
            value={draft.tags}
            suggestions={tagSuggestions}
            placeholder="Type a tag..."
            onChange={(tags) => setDraft({ ...draft, tags })}
          />
        </div>

        <div className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
          <label htmlFor={noteEditorId}>Note</label>
          <RichEditor
            visual
            id={noteEditorId}
            editorRef={noteEditorRef}
            templateScope="missed"
            defaultMode="edit"
            value={draft.notes}
            onChange={(notes) => setDraft({ ...draft, notes })}
            placeholder="Why did you miss it? What will you do differently?"
            showTradeLink={false}
            showDictate
          />
        </div>

        <Field label="TradingView snapshot URL">
          <input
            ref={snapshotUrlRef}
            className={fieldClass}
            type="url"
            placeholder="https://www.tradingview.com/x/NOT-A-REAL-SNAPSHOT/"
            value={draft.tradingViewUrl}
            onChange={(event) => setDraft({ ...draft, tradingViewUrl: event.target.value })}
          />
        </Field>

        {draft.playbookId &&
          (() => {
            const book = books?.playbooks.find((item) => item.id === draft.playbookId);
            if (!book) return null;
            return (
              <div>
                <div className="mb-1 text-xs text-muted-foreground">Strategy rule review</div>
                <div className="rounded-lg border p-4">
                  <div className="space-y-1">
                    {book.rules.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Add rules to this strategy to review adherence.
                      </p>
                    ) : (
                      book.rules.map((rule) => {
                        const current =
                          draft.ruleChecks.find((item) => item.rule === rule)?.followed ?? null;
                        return (
                          <div
                            key={rule}
                            className="flex items-center justify-between gap-2 py-0.5 text-sm"
                          >
                            <span>{rule}</span>
                            <OptionSelect
                              className={`${fieldClass} !w-32 shrink-0`}
                              value={current === null ? "unreviewed" : String(current)}
                              onValueChange={(next) =>
                                setDraft({
                                  ...draft,
                                  ruleChecks: draft.ruleChecks.map((item) =>
                                    item.rule === rule
                                      ? {
                                          ...item,
                                          followed: next === "unreviewed" ? null : next === "true",
                                        }
                                      : item,
                                  ),
                                })
                              }
                            >
                              <option value="unreviewed">Not assessed</option>
                              <option value="true">Followed</option>
                              <option value="false">Broken</option>
                            </OptionSelect>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !draft.symbol.trim() || !draft.observedAt}
            onClick={async () => {
              setBusy(true);
              setFailure("");
              try {
                const saved = await postJson<{ id?: string; trade?: { id?: string } }>(
                  "/api/workspace/missed",
                  {
                    id: editing,
                    symbol: draft.symbol,
                    observedAt: draft.observedAt,
                    playbookId: draft.playbookId,
                    outcome: draft.outcome,
                    tags: draft.tags,
                    tradingViewUrl: draft.tradingViewUrl,
                    notes: draft.notes,
                    ruleChecks: draft.ruleChecks,
                  },
                );
                const savedId = editing ?? saved.id ?? saved.trade?.id ?? null;
                setOpen(false);
                onSaved(savedId, {
                  symbol: draft.symbol.trim().toUpperCase(),
                  observedAt: draft.observedAt,
                });
              } catch (e) {
                setFailure(e instanceof Error ? e.message : "Could not save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
