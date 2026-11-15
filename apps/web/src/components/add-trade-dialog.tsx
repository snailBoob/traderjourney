"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { postJson, useApi } from "@/lib/use-api";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { DateTimePicker } from "./ui/date-time-picker";
import { Label } from "./ui/label";
import { OptionSelect } from "./ui/option-select";
import { RichEditor, type RichEditorHandle } from "./rich-editor";
import { TagInput } from "./tag-input";
import { RuleChecklist } from "./rule-checklist";
import { Checkbox } from "./ui/checkbox";
import { fieldClass, Field } from "./filter-fields";

type Account = { id: string; name: string; kind: string; archivedAt: string | null };
type Execution = {
  id?: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number | string;
  executedAt: string;
};
type Trade = {
  key: string;
  accountId: string;
  tradingViewUrl: string | null;
  symbol: string;
  notes: string | null;
  tagsJson: string | null;
  mistakesJson: string | null;
  reasonForExitJson: string | null;
  exitOutcome: string | null;
  totalPossibleR: number | null;
  volumeAfterTp: string | null;
  priceActionJson: string | null;
  playbookId: string | null;
  rating: number | null;
  reviewedAt: string | null;
  stopLoss: number | null;
  profitTarget: number | null;
};
type Detail = { trade: Trade; executions: Execution[] };
type Draft = {
  accountId: string;
  symbol: string;
  notes: string;
  tags: string[];
  mistakes: string[];
  reasons: string[];
  cutResult: string;
  totalR: string;
  volumeDirection: string;
  pattern: string[];
  strategy: string;
  rating: string;
  reviewed: boolean;
  stopLoss: string;
  takeProfit: string;
  tradingViewUrl: string;
  executions: Execution[];
};
const parse = (s: string | null | undefined): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const localDateTime = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const dateTimeLocalFromIso = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : localDateTime();
};
const emptyDraft = (accountId = ""): Draft => ({
  accountId,
  symbol: "",
  notes: "",
  tags: [],
  mistakes: [],
  reasons: [],
  cutResult: "",
  totalR: "",
  volumeDirection: "",
  pattern: [],
  strategy: "",
  rating: "",
  reviewed: false,
  stopLoss: "",
  takeProfit: "",
  tradingViewUrl: "",
  executions: [
    { symbol: "", side: "buy", quantity: 0, price: 0, fee: "", executedAt: localDateTime() },
  ],
});
const draftFrom = (trade: Trade, executions: Execution[], tradingViewUrl = ""): Draft => ({
  accountId: trade.accountId,
  symbol: trade.symbol,
  notes: trade.notes ?? "",
  tags: parse(trade.tagsJson),
  mistakes: parse(trade.mistakesJson),
  reasons: parse(trade.reasonForExitJson),
  cutResult: trade.exitOutcome ?? "",
  totalR: trade.totalPossibleR == null ? "" : String(trade.totalPossibleR),
  volumeDirection: trade.volumeAfterTp ?? "",
  pattern: parse(trade.priceActionJson),
  strategy: trade.playbookId ?? "",
  rating: trade.rating == null ? "" : String(trade.rating),
  reviewed: Boolean(trade.reviewedAt),
  stopLoss: trade.stopLoss == null ? "" : String(trade.stopLoss),
  takeProfit: trade.profitTarget == null ? "" : String(trade.profitTarget),
  tradingViewUrl,
  executions: executions.map((e) => ({
    ...e,
    executedAt: e.executedAt ? dateTimeLocalFromIso(e.executedAt) : localDateTime(),
  })),
});

export function AddTradeDialog({
  onSaved,
  className,
  query = "",
  initialEditKey = null,
  initialEditFocus = null,
  expandedTradeKey = null,
  onEditRequestHandled,
}: {
  onSaved: (tradeKey?: string) => void;
  className?: string;
  query?: string;
  initialEditKey?: string | null;
  initialEditFocus?: "note" | "snapshot" | null;
  expandedTradeKey?: string | null;
  onEditRequestHandled?: () => void;
}) {
  const params = useSearchParams();
  const selectedAccounts = params.get("accounts")?.split(",").filter(Boolean) ?? [];
  const { data: accountsData } = useApi<{ accounts: Account[] }>("/api/accounts");
  const accounts = (accountsData?.accounts ?? []).filter((a) => !a.archivedAt);
  const selectedAccountId = selectedAccounts.length === 1 ? selectedAccounts[0] : "";
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const tradesUrlForAccount = (accountId: string) => {
    const search = new URLSearchParams(query);
    search.set("accounts", accountId);
    search.set("view", "list");
    return `/api/trades?${search.toString()}`;
  };
  const [open, setOpen] = useState(false);
  const [pendingFocusTarget, setPendingFocusTarget] = useState<"note" | "snapshot" | null>(null);
  const snapshotUrlRef = useRef<HTMLInputElement>(null);
  const noteEditorRef = useRef<RichEditorHandle>(null);
  const noteEditorId = useId();
  const [tradeKey, setTradeKey] = useState<string | null>(null);
  const { data: listData } = useApi<{ trades: { key: string; openedAt: string }[] }>(
    selectedAccount && selectedAccount.kind !== "manual"
      ? tradesUrlForAccount(selectedAccount.id)
      : null,
  );
  const topTradeKey = listData?.trades?.length
    ? ([...listData.trades].sort(
        (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || b.key.localeCompare(a.key),
      )[0]?.key ?? null)
    : null;
  const { data: detail, refresh: refreshDetail } = useApi<Detail>(
    open && tradeKey ? `/api/trades/${encodeURIComponent(tradeKey)}` : null,
  );
  const { data: books } = useApi<{ playbooks: { id: string; name: string; rules: string[] }[] }>(
    "/api/playbooks",
  );
  const { data: suggestions, refresh: refreshSuggestions } = useApi<{
    tags: string[];
    mistakes?: string[];
    reasonForExit?: string[];
    patternDuringTrade?: string[];
  }>("/api/trades/annotation-suggestions");
  const [draft, setDraft] = useState<Draft>(emptyDraft(selectedAccountId));
  const [busy, setBusy] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [draftRuleChecks, setDraftRuleChecks] = useState<Record<string, boolean | null>>({});
  const [totalRFocused, setTotalRFocused] = useState(false);
  const currentAccount = accounts.find((a) => a.id === draft.accountId);
  const manualMode = !currentAccount || currentAccount.kind === "manual";

  useEffect(() => {
    if (detail?.trade && tradeKey) {
      const next = draftFrom(
        detail.trade,
        detail.executions,
        detail.trade.tradingViewUrl ?? savedUrl,
      );
      setDraft(next);
      setError("");
    }
    // savedUrl is updated after detail load; reset only when fetched record changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.trade?.key]);

  useEffect(() => {
    if (initialEditKey) {
      setTotalRFocused(false);
      setDraft(emptyDraft(selectedAccountId));
      setTradeKey(initialEditKey);
      setSavedUrl("");
      setPendingFocusTarget(initialEditFocus);
      setOpen(true);
      onEditRequestHandled?.();
    }
  }, [initialEditKey]);
  useEffect(() => {
    if (!open || !detail?.trade || !pendingFocusTarget) return;
    const frame = requestAnimationFrame(() => {
      if (pendingFocusTarget === "snapshot") snapshotUrlRef.current?.focus();
      else noteEditorRef.current?.focus();
      setPendingFocusTarget(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, detail?.trade?.key, pendingFocusTarget]);

  const startAdd = () => {
    setTotalRFocused(false);
    const next = emptyDraft(selectedAccountId);
    setTradeKey(null);
    setDraft(next);
    setError("");
    setSavedUrl("");
    setOpen(true);
  };
  const startEdit = () => {
    const targetKey = expandedTradeKey ?? topTradeKey;
    if (!targetKey) return;
    setTotalRFocused(false);
    const next = emptyDraft(selectedAccountId);
    setDraft(next);
    setTradeKey(targetKey);
    setSavedUrl("");
    setOpen(true);
  };
  const closeNow = () => {
    setOpen(false);
    setTradeKey(null);
    setTotalRFocused(false);
  };
  const save = async (closeAfter = true) => {
    if (busy) return;
    setBusy(true);
    setError("");
    let savedTradeKey: string | undefined = tradeKey ?? undefined;
    try {
      if (
        manualMode &&
        (!draft.symbol.trim() ||
          !draft.executions.some(
            (e) =>
              Number(e.quantity) > 0 &&
              Number.isFinite(Number(e.quantity)) &&
              Number(e.price) > 0 &&
              Number.isFinite(Number(e.price)) &&
              Boolean(e.executedAt) &&
              Number.isFinite(Date.parse(e.executedAt)),
          ))
      ) {
        throw new Error(
          "Enter a symbol and at least one valid execution with date, quantity and price.",
        );
      }
      if (tradeKey) {
        const saveResult = await postJson<{ snapshotSaved?: boolean }>(
          `/api/trades/${encodeURIComponent(tradeKey)}`,
          {
            notes: draft.notes,
            tags: draft.tags,
            mistakes: draft.mistakes,
            reasonForExit: draft.reasons,
            exitOutcome: draft.reasons.length ? draft.cutResult || null : null,
            totalPossibleR: draft.totalR.trim() === "" ? null : Number(draft.totalR),
            volumeAfterTp: Number(draft.totalR) > 0 ? draft.volumeDirection || null : null,
            patternDuringTrade: draft.pattern,
            playbookId: draft.strategy || null,
            rating: draft.rating ? Number(draft.rating) : null,
            reviewed: draft.reviewed,
            stopLoss: draft.stopLoss === "" ? null : Number(draft.stopLoss),
            profitTarget: draft.takeProfit === "" ? null : Number(draft.takeProfit),
            tradingViewUrl: draft.tradingViewUrl,
          },
          "PATCH",
        );
        if (draft.tradingViewUrl.trim() && !saveResult.snapshotSaved) {
          throw new Error(
            "The trade was not saved with a TradingView snapshot. The snapshot record is missing; the edit window remains open so you can retry.",
          );
        }
        for (const e of draft.executions)
          if (e.id) {
            const existing = detail?.executions.find((item) => item.id === e.id);
            const executedAt = new Date(e.executedAt).toISOString();
            const unchanged =
              Boolean(existing) &&
              existing!.symbol.trim().toUpperCase() === draft.symbol.trim().toUpperCase() &&
              existing!.side === e.side &&
              Number(existing!.quantity) === Number(e.quantity) &&
              Number(existing!.price) === Number(e.price) &&
              Number(existing!.fee ?? 0) === Number(e.fee || 0) &&
              Date.parse(existing!.executedAt) === Date.parse(executedAt);
            if (unchanged) continue;
            const result = await postJson<{ tradeKey?: string | null }>(
              `/api/executions/${encodeURIComponent(e.id)}`,
              {
                symbol: draft.symbol,
                side: e.side,
                quantity: Number(e.quantity),
                price: Number(e.price),
                fee: Number(e.fee || 0),
                executedAt,
              },
              "PATCH",
            );
            if (result.tradeKey) savedTradeKey = result.tradeKey;
          }
        for (const e of draft.executions)
          if (!e.id && Number(e.quantity) > 0 && Number(e.price) > 0) {
            const result = await postJson<{ tradeKey?: string; tradeKeys?: string[] }>(
              "/api/executions",
              {
                accountId: draft.accountId,
                executions: [
                  {
                    symbol: draft.symbol,
                    side: e.side,
                    quantity: Number(e.quantity),
                    price: Number(e.price),
                    fee: Number(e.fee || 0),
                    executedAt: new Date(e.executedAt).toISOString(),
                  },
                ],
              },
            );
            savedTradeKey = result.tradeKey ?? result.tradeKeys?.[0] ?? savedTradeKey;
          }
        for (const old of detail?.executions ?? [])
          if (old.id && !draft.executions.some((e) => e.id === old.id)) {
            const result = await postJson<{ tradeKey?: string | null }>(
              `/api/executions/${encodeURIComponent(old.id)}`,
              undefined,
              "DELETE",
            );
            if (result.tradeKey) savedTradeKey = result.tradeKey;
          }
      } else {
        const valid = draft.executions.filter(
          (e) => Number(e.quantity) > 0 && Number(e.price) > 0 && e.executedAt,
        );
        if (!draft.accountId || !draft.symbol.trim() || valid.length === 0)
          throw new Error(
            "Select one Manual account in the account filter, enter a symbol and add at least one valid execution.",
          );
        const inserted = await postJson<{ tradeKeys: string[]; tradeKey?: string }>(
          "/api/executions",
          {
            accountId: draft.accountId,
            notes: draft.notes,
            executions: valid.map((e) => ({
              symbol: draft.symbol.trim().toUpperCase(),
              side: e.side,
              quantity: Number(e.quantity),
              price: Number(e.price),
              fee: Number(e.fee || 0),
              executedAt: new Date(e.executedAt).toISOString(),
            })),
          },
        );
        const key = inserted.tradeKey ?? inserted.tradeKeys?.[0];
        if (!key)
          throw new Error(
            "Executions were submitted, but TraderJourney could not identify the resulting trade. Save again to retry the annotations.",
          );
        savedTradeKey = key;
        // Keep this record as the active edit target if annotation/snapshot saving
        // fails after the executions have already created the trade. Retrying must
        // update this trade rather than create a duplicate.
        setTradeKey(key);
        {
          const saveResult = await postJson<{ snapshotSaved?: boolean }>(
            `/api/trades/${encodeURIComponent(key)}`,
            {
              notes: draft.notes,
              tags: draft.tags,
              mistakes: draft.mistakes,
              reasonForExit: draft.reasons,
              exitOutcome: draft.reasons.length ? draft.cutResult || null : null,
              totalPossibleR: draft.totalR.trim() === "" ? null : Number(draft.totalR),
              volumeAfterTp: Number(draft.totalR) > 0 ? draft.volumeDirection || null : null,
              patternDuringTrade: draft.pattern,
              playbookId: draft.strategy || null,
              rating: draft.rating ? Number(draft.rating) : null,
              reviewed: draft.reviewed,
              stopLoss: draft.stopLoss === "" ? null : Number(draft.stopLoss),
              profitTarget: draft.takeProfit === "" ? null : Number(draft.takeProfit),
              tradingViewUrl: draft.tradingViewUrl,
            },
            "PATCH",
          );
          if (draft.tradingViewUrl.trim() && !saveResult.snapshotSaved) {
            throw new Error(
              "The trade was created, but its TradingView snapshot was not stored. The edit window remains open so you can retry.",
            );
          }
          for (const [rule, followed] of Object.entries(draftRuleChecks)) {
            if (followed !== null)
              await postJson(`/api/trades/${encodeURIComponent(key)}/rules`, {
                playbookId: draft.strategy,
                rule,
                followed,
              });
          }
        }
      }
      // Newly saved tags, mistakes, exit reasons, and patterns are queried from persisted trades.
      // Refresh that source after every successful save so they can be reused immediately.
      refreshSuggestions();
      if (closeAfter) {
        closeNow();
        onSaved(savedTradeKey);
      } else {
        closeNow();
        onSaved(savedTradeKey);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save trade.");
    } finally {
      setBusy(false);
    }
  };
  const requestClose = (nextOpen: boolean) => {
    if (!nextOpen) closeNow();
    else setOpen(true);
  };
  const deleteTrade = async () => {
    if (!tradeKey || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await postJson(`/api/trades/${encodeURIComponent(tradeKey)}`, undefined, "DELETE");
      refreshSuggestions();
      setDeleteConfirmOpen(false);
      closeNow();
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete this trade.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {selectedAccount && selectedAccount.kind !== "manual" ? (
        <Button
          size="sm"
          className={className}
          onClick={startEdit}
          disabled={!(expandedTradeKey ?? topTradeKey)}
        >
          <Pencil className="size-3.5" /> Edit trade
        </Button>
      ) : (
        <Button size="sm" className={className} onClick={startAdd}>
          <Plus className="size-3.5" /> Add trade
        </Button>
      )}
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tradeKey ? "Edit trade" : "Add trade"}</DialogTitle>
            <DialogDescription className="sr-only">Trade details and executions.</DialogDescription>
          </DialogHeader>
          {tradeKey && !detail ? (
            <p className="text-sm text-muted-foreground">Loading trade…</p>
          ) : (
            <fieldset disabled={busy} className="space-y-3">
              {tradeKey ? (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">Rate this trade</div>
                  <div className="grid min-h-5 grid-cols-2 items-center gap-3">
                    <div
                      className="flex items-center gap-1"
                      role="radiogroup"
                      aria-label="Rate this trade"
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          aria-label={`${star} star${star === 1 ? "" : "s"}`}
                          aria-pressed={Number(draft.rating) >= star}
                          className={`text-xl leading-none ${Number(draft.rating) >= star ? "text-amber-500" : "text-muted-foreground/40"}`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              rating: Number(draft.rating) === star ? "" : String(star),
                            })
                          }
                        >
                          ★
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.reviewed}
                        onCheckedChange={(checked) =>
                          setDraft({ ...draft, reviewed: checked === true })
                        }
                      />
                      Reviewed
                    </label>
                  </div>
                </div>
              ) : null}
              {!manualMode && !tradeKey && (
                <p className="text-sm text-muted-foreground">
                  Broker trades are created by broker sync. Select an existing trade to edit it.
                </p>
              )}
              {tradeKey && !manualMode && (
                <Field label="Symbol">
                  <Input
                    value={draft.symbol}
                    readOnly
                    aria-readonly="true"
                    tabIndex={-1}
                    className="bg-muted/60 text-muted-foreground border-muted focus:border-muted focus-visible:border-muted focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </Field>
              )}
              {manualMode && (
                <>
                  <Field label="Symbol">
                    <input
                      className={fieldClass}
                      required
                      placeholder={tradeKey ? undefined : "BTCUSDT, ETHBTC..."}
                      value={draft.symbol}
                      onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })}
                    />
                  </Field>
                  <div className="space-y-2">
                    {draft.executions.map((e, i) => (
                      <div key={e.id ?? `new-${i}`} className="relative rounded-md border p-3">
                        <div className="absolute right-2 top-2 z-10">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Delete execution ${i + 1}`}
                            title="Delete execution"
                            className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={draft.executions.length <= 1}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                executions: draft.executions.filter((_, j) => i !== j),
                              })
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <div className="grid items-end gap-2 pr-8 md:grid-cols-[minmax(0,1.8fr)_minmax(80px,.8fr)_minmax(90px,1fr)_minmax(90px,1fr)_minmax(90px,.8fr)]">
                          <Field label="Date & time">
                            <DateTimePicker
                              value={e.executedAt}
                              onValueChange={(value) =>
                                setDraft({
                                  ...draft,
                                  executions: draft.executions.map((x, j) =>
                                    j === i ? { ...x, executedAt: value } : x,
                                  ),
                                })
                              }
                              label="Execution date and time"
                            />
                          </Field>
                          <Field label="Side">
                            <select
                              className={fieldClass}
                              value={e.side}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  executions: draft.executions.map((x, j) =>
                                    j === i
                                      ? { ...x, side: event.target.value as "buy" | "sell" }
                                      : x,
                                  ),
                                })
                              }
                            >
                              <option value="buy">Buy</option>
                              <option value="sell">Sell</option>
                            </select>
                          </Field>
                          <Field label="Quantity">
                            <Input
                              className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              type="number"
                              step="0.01"
                              required
                              min="0.01"
                              value={e.quantity || ""}
                              onChange={(event) => {
                                const raw = event.target.value;
                                const quantity =
                                  raw === "" ? 0 : Math.round(Number(raw) * 100) / 100;
                                setDraft({
                                  ...draft,
                                  executions: draft.executions.map((x, j) =>
                                    j === i ? { ...x, quantity } : x,
                                  ),
                                });
                              }}
                            />
                          </Field>
                          <Field label="Price">
                            <Input
                              className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              type="number"
                              required
                              min="0.00000001"
                              value={e.price || ""}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  executions: draft.executions.map((x, j) =>
                                    j === i ? { ...x, price: Number(event.target.value) } : x,
                                  ),
                                })
                              }
                            />
                          </Field>
                          <Field label="Fee">
                            <Input
                              className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              type="number"
                              value={e.fee}
                              onChange={(event) =>
                                setDraft({
                                  ...draft,
                                  executions: draft.executions.map((x, j) =>
                                    j === i ? { ...x, fee: event.target.value } : x,
                                  ),
                                })
                              }
                            />
                          </Field>
                        </div>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          executions: [
                            ...draft.executions,
                            {
                              symbol: draft.symbol,
                              side: "sell",
                              quantity: 0,
                              price: 0,
                              fee: "",
                              executedAt: localDateTime(),
                            },
                          ],
                        })
                      }
                    >
                      <Plus className="size-3.5" /> Add execution
                    </Button>
                  </div>
                </>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Take profit">
                  <Input
                    className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    type="number"
                    value={draft.takeProfit}
                    onChange={(e) => setDraft({ ...draft, takeProfit: e.target.value })}
                  />
                </Field>
                <Field label="Stop loss">
                  <Input
                    id="trade-stop-loss"
                    className="[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    type="number"
                    value={draft.stopLoss}
                    onChange={(e) => setDraft({ ...draft, stopLoss: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Strategy">
                  <OptionSelect
                    className={fieldClass}
                    value={draft.strategy}
                    onValueChange={(value) => {
                      setDraft({ ...draft, strategy: value });
                      setDraftRuleChecks({});
                    }}
                  >
                    <option value="">No strategy</option>
                    {books?.playbooks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </OptionSelect>
                </Field>
                <Field label="Tags">
                  <TagInput
                    value={draft.tags}
                    suggestions={suggestions?.tags ?? []}
                    placeholder="Type a tag..."
                    closeOnSelect={false}
                    onChange={(tags) => setDraft({ ...draft, tags })}
                  />
                </Field>
              </div>
              <div className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
                <label htmlFor={noteEditorId}>Notes</label>
                <RichEditor
                  visual
                  id={noteEditorId}
                  editorRef={noteEditorRef}
                  templateScope="trade"
                  defaultMode="edit"
                  value={draft.notes}
                  onChange={(notes) => setDraft({ ...draft, notes })}
                  placeholder="Trade notes"
                  showTradeLink={false}
                  showDictate
                />
              </div>
              <Field label="TradingView snapshot URL">
                <input
                  ref={snapshotUrlRef}
                  type="url"
                  placeholder="https://www.tradingview.com/x/NOT-A-REAL-SNAPSHOT/"
                  className={fieldClass}
                  value={draft.tradingViewUrl}
                  onChange={(e) => setDraft({ ...draft, tradingViewUrl: e.target.value })}
                />
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Mistakes">
                  <TagInput
                    value={draft.mistakes}
                    suggestions={suggestions?.mistakes ?? []}
                    placeholder="Add mistake..."
                    onChange={(mistakes) => setDraft({ ...draft, mistakes })}
                  />
                </Field>
                <Field label="Pattern during trade">
                  <TagInput
                    value={draft.pattern}
                    suggestions={suggestions?.patternDuringTrade ?? []}
                    placeholder="Select pattern..."
                    onChange={(pattern) => setDraft({ ...draft, pattern })}
                  />
                </Field>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Reason for cutting the trade">
                  <TagInput
                    value={draft.reasons}
                    suggestions={suggestions?.reasonForExit ?? []}
                    placeholder="Add reason..."
                    onChange={(reasons) =>
                      setDraft({
                        ...draft,
                        reasons,
                        cutResult: reasons.length ? draft.cutResult : "",
                      })
                    }
                  />
                </Field>
                <Field label="Total possible R">
                  <Input
                    className="[appearance:textfield]"
                    type="text"
                    inputMode="decimal"
                    value={
                      totalRFocused
                        ? draft.totalR
                        : draft.totalR.trim() === ""
                          ? ""
                          : Number.isFinite(Number(draft.totalR))
                            ? Number(draft.totalR).toFixed(2)
                            : draft.totalR
                    }
                    onFocus={() => setTotalRFocused(true)}
                    onBlur={() => {
                      setTotalRFocused(false);
                      setDraft((current) => ({
                        ...current,
                        totalR:
                          current.totalR.trim() === ""
                            ? ""
                            : Number.isFinite(Number(current.totalR))
                              ? Number(current.totalR).toFixed(2)
                              : current.totalR,
                      }));
                    }}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        totalR: e.target.value,
                        volumeDirection: Number(e.target.value) > 0 ? draft.volumeDirection : "",
                      })
                    }
                  />
                </Field>
              </div>
              {(draft.reasons.length > 0 || Number(draft.totalR) > 0) && (
                <div className="grid gap-3 md:grid-cols-2">
                  {draft.reasons.length > 0 ? (
                    <Field label="Outcome">
                      <select
                        className={fieldClass}
                        value={draft.cutResult}
                        onChange={(e) => setDraft({ ...draft, cutResult: e.target.value })}
                      >
                        <option value="">Select</option>
                        <option>SL hit</option>
                        <option>TP hit</option>
                      </select>
                    </Field>
                  ) : (
                    <div />
                  )}
                  {Number(draft.totalR) > 0 && (
                    <Field label="Volume direction">
                      <select
                        className={fieldClass}
                        value={draft.volumeDirection}
                        onChange={(e) => setDraft({ ...draft, volumeDirection: e.target.value })}
                      >
                        <option value="">Select</option>
                        <option>Up</option>
                        <option>Down</option>
                        <option>Flat</option>
                      </select>
                    </Field>
                  )}
                </div>
              )}
              {tradeKey && draft.strategy ? (
                <div className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">Strategy rule review</div>
                  <RuleChecklist
                    key={`${tradeKey}:${draft.strategy}`}
                    tradeKey={tradeKey}
                    playbookId={draft.strategy}
                    showTitle={false}
                  />
                </div>
              ) : !tradeKey && manualMode && draft.strategy ? (
                <div className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">Strategy rule review</div>
                  <div className="card-sheen min-w-0 rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
                    <div className="space-y-3">
                      <div className="text-sm font-medium">
                        {books?.playbooks.find((b) => b.id === draft.strategy)?.name ??
                          "Selected strategy"}
                      </div>
                      {(books?.playbooks.find((b) => b.id === draft.strategy)?.rules ?? []).map(
                        (rule) => (
                          <label
                            key={rule}
                            className="flex items-center justify-between gap-3 border-t pt-2 text-sm"
                          >
                            <span>{rule}</span>
                            <OptionSelect
                              aria-label={rule}
                              className={`${fieldClass} !w-36 shrink-0`}
                              value={
                                draftRuleChecks[rule] === true
                                  ? "true"
                                  : draftRuleChecks[rule] === false
                                    ? "false"
                                    : "unreviewed"
                              }
                              onValueChange={(value) =>
                                setDraftRuleChecks((old) => ({
                                  ...old,
                                  [rule]: value === "unreviewed" ? null : value === "true",
                                }))
                              }
                            >
                              <option value="unreviewed">Not assessed</option>
                              <option value="true">Followed</option>
                              <option value="false">Broken</option>
                            </OptionSelect>
                          </label>
                        ),
                      )}
                      {!books?.playbooks.find((b) => b.id === draft.strategy)?.rules.length && (
                        <p className="text-xs text-muted-foreground">
                          No rules configured for this Strategy.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 border-t pt-3">
                <div>
                  {tradeKey &&
                    detail?.trade &&
                    accounts.find((account) => account.id === detail.trade.accountId)?.kind ===
                      "manual" && (
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={busy || deleting}
                        onClick={() => {
                          setError("");
                          setDeleteConfirmOpen(true);
                        }}
                      >
                        Delete
                      </Button>
                    )}
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => requestClose(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => save()}
                    disabled={busy || deleting || (!tradeKey && !manualMode)}
                  >
                    {busy ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </fieldset>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (!deleting) setDeleteConfirmOpen(nextOpen);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete trade?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Delete this trade? This cannot be undone.</p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteTrade()}
            >
              {deleting ? "Deleting…" : "Delete trade"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
