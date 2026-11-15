"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { MonetaryValue } from "@/components/privacy";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/use-api";
import { publishHeaderNotice } from "@/lib/header-notice";
import { fmtFee, fmtNumber } from "@/lib/utils";
import { formatTimestamp } from "@/lib/timezone";
import { RuleChecklist } from "@/components/rule-checklist";
import { Markdown } from "@/components/rich-editor";

type TradeExpandedData = {
  timeZone: string;
  executions: {
    id: string;
    executedAt: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    fee: number;
  }[];
  trade: {
    key: string;
    accountId: string;
    tradingViewUrl: string | null;
    hasSnapshot: boolean;
    symbol: string;
    direction: string;
    status: string;
    openedAt: string;
    closedAt: string | null;
    quantity: number;
    avgEntry: number;
    avgExit: number | null;
    grossPnl: number;
    fees: number;
    netPnl: number;
    durationMs: number | null;
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
    stopLoss: number | null;
    profitTarget: number | null;
    reviewedAt: string | null;
  };
};

function safeArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function ExpandedTrade({
  tradeKey,
  onEdit,
}: {
  tradeKey: string;
  onEdit: (focusTarget?: "note" | "snapshot") => void;
}) {
  const { data, error } = useApi<TradeExpandedData>(`/api/trades/${encodeURIComponent(tradeKey)}`);
  const { data: strategies } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks",
  );
  const [fullscreenSnapshot, setFullscreenSnapshot] = useState(false);
  const [snapshotLoadError, setSnapshotLoadError] = useState(false);
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  if (!data) return <div className="h-24 animate-pulse rounded-md bg-muted" />;
  const trade = data.trade;
  const tags = safeArray(trade.tagsJson);
  const mistakes = safeArray(trade.mistakesJson);
  const reasons = safeArray(trade.reasonForExitJson);
  const patterns = safeArray(trade.priceActionJson);
  const hasSnapshot = data.trade.hasSnapshot;
  const executions = [...data.executions].sort(
    (a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt),
  );
  const share = async () => {
    if (!trade.tradingViewUrl) {
      publishHeaderNotice("No TradingView URL available.");
      return;
    }
    try {
      await navigator.clipboard.writeText(trade.tradingViewUrl);
      publishHeaderNotice("URL copied to clipboard");
    } catch {
      publishHeaderNotice("Could not copy the TradingView URL.");
    }
  };
  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={share}
            disabled={!trade.tradingViewUrl}
          >
            <Share2 className="size-3.5" />
            Share
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit()}>
              Edit
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="card-sheen flex min-w-0 flex-[2] flex-col rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Snapshot
              </div>
              <div className="mt-3 flex min-h-48 flex-1 items-center justify-center rounded-lg border border-border/70 bg-background p-3">
                {hasSnapshot ? (
                  snapshotLoadError ? (
                    <div role="alert" className="py-6 text-center text-sm text-destructive">
                      The snapshot is recorded, but its image could not be loaded. Re-save the
                      TradingView URL in Edit to retry.
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="block min-w-0 w-full"
                      onClick={() => setFullscreenSnapshot(true)}
                      aria-label="Open snapshot"
                    >
                      <img
                        src={`/api/snapshots/trade/${encodeURIComponent(trade.key)}`}
                        alt="TradingView snapshot"
                        onError={() => setSnapshotLoadError(true)}
                        className="block h-auto max-h-none w-full max-w-full cursor-zoom-in object-contain"
                      />
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="flex min-h-24 w-full items-center justify-center text-center text-sm"
                    onClick={() => onEdit("snapshot")}
                  >
                    Add a TradingView snapshot using <span className="ml-1 underline">Edit</span>
                  </button>
                )}
              </div>
            </section>
            <section className="card-sheen min-w-0 rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Executions
              </div>
              {executions.length ? (
                <div className="mt-3 overflow-x-auto rounded-lg border border-border/70 bg-background">
                  <table className="entry-executions w-full text-sm">
                    <thead className="border-b">
                      <tr>
                        {["Time", "Side", "Quantity", "Price", "Fee"].map((label) => (
                          <th
                            key={label}
                            className="whitespace-nowrap px-2 py-2 text-left text-xs font-medium text-muted-foreground"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {executions.map((execution) => (
                        <tr key={execution.id} className="border-b last:border-0">
                          <td
                            data-label="Time"
                            className="whitespace-nowrap px-2 py-2 text-muted-foreground tnum"
                          >
                            {formatTimestamp(execution.executedAt, data.timeZone)}
                          </td>
                          <td
                            data-label="Side"
                            className={`whitespace-nowrap px-2 py-2 font-medium ${execution.side === "buy" ? "text-profit" : "text-loss"}`}
                          >
                            {execution.side === "buy" ? "▲ BUY" : "▼ SELL"}
                          </td>
                          <td data-label="Quantity" className="whitespace-nowrap px-2 py-2 tnum">
                            {fmtNumber(execution.quantity, 6)}
                          </td>
                          <td data-label="Price" className="whitespace-nowrap px-2 py-2 tnum">
                            <MonetaryValue>{fmtNumber(execution.price, 6)}</MonetaryValue>
                          </td>
                          <td data-label="Fee" className="whitespace-nowrap px-2 py-2 tnum">
                            <MonetaryValue>{fmtFee(execution.fee)}</MonetaryValue>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-3 flex min-h-16 items-center justify-center rounded-lg border border-border/70 bg-background p-3 text-sm text-muted-foreground">
                  No executions available.
                </div>
              )}
            </section>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <section className="card-sheen min-w-0 rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Trade information
              </div>
              <div className="mt-3 min-w-0">
                <div className="grid grid-cols-2 gap-x-3 border-b border-border/70">
                  <Info
                    label="Rating"
                    value={trade.rating == null ? "—" : "★".repeat(trade.rating)}
                  />
                  <Info label="Reviewed" value={trade.reviewedAt ? "✓" : "—"} />
                </div>
                <div className="grid grid-cols-2 gap-x-3 border-b border-border/70">
                  <Info
                    label="Take Profit"
                    value={trade.profitTarget == null ? "—" : fmtNumber(trade.profitTarget, 6)}
                  />
                  <Info
                    label="Stop Loss"
                    value={trade.stopLoss == null ? "—" : fmtNumber(trade.stopLoss, 6)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-x-3 border-b border-border/70">
                  <Info
                    label="Strategy"
                    value={
                      strategies?.playbooks.find((item) => item.id === trade.playbookId)?.name ??
                      "—"
                    }
                  />
                  <div className="py-1.5">
                    <div className="text-xs text-muted-foreground">Tags</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {tags.length
                        ? tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-sm"
                            >
                              <span className="truncate">{tag}</span>
                            </span>
                          ))
                        : "—"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 border-b border-border/70">
                  <div className="py-1.5">
                    <div className="text-xs text-muted-foreground">Mistakes</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {mistakes.length
                        ? mistakes.map((item) => (
                            <span
                              key={item}
                              className="inline-flex max-w-full rounded-md bg-muted px-2 py-0.5 text-sm text-foreground"
                            >
                              {item}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </div>
                  <div className="py-1.5">
                    <div className="text-xs text-muted-foreground">Pattern during trade</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {patterns.length
                        ? patterns.map((item) => (
                            <span
                              key={item}
                              className="inline-flex max-w-full rounded-md bg-muted px-2 py-0.5 text-sm text-foreground"
                            >
                              {item}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-3 border-b border-border/70">
                  <div className="py-1.5">
                    <div className="text-xs text-muted-foreground">Reason for cutting trade</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {reasons.length
                        ? reasons.map((item) => (
                            <span
                              key={item}
                              className="inline-flex max-w-full rounded-md bg-muted px-2 py-0.5 text-sm text-foreground"
                            >
                              {item}
                            </span>
                          ))
                        : "—"}
                    </div>
                  </div>
                  <Info label="Outcome" value={trade.exitOutcome ?? "—"} />
                </div>
                <div className="grid grid-cols-2 gap-x-3">
                  <Info
                    label="Total possible R"
                    value={trade.totalPossibleR == null ? "—" : trade.totalPossibleR.toFixed(2)}
                  />
                  <Info
                    label="Volume direction"
                    value={Number(trade.totalPossibleR) > 0 ? (trade.volumeAfterTp ?? "—") : "—"}
                  />
                </div>
              </div>
            </section>
            <section className="card-sheen flex min-w-0 flex-1 flex-col rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Note
              </div>
              <div
                className={`mt-3 min-h-24 flex-1 text-sm leading-6 ${trade.notes ? "" : "flex items-center justify-center text-center"}`}
              >
                {trade.notes ? (
                  <div className="w-full text-left">
                    <Markdown>{trade.notes}</Markdown>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-muted-foreground"
                    onClick={() => onEdit("note")}
                  >
                    Add a note using <span className="underline">Edit</span>
                  </button>
                )}
              </div>
            </section>
            <section className="min-w-0 flex-1 [&>div]:h-full">
              <RuleChecklist
                tradeKey={trade.key}
                playbookId={trade.playbookId}
                showTitle
                readOnly
                className="h-full"
              />
            </section>
          </div>
        </div>
        {fullscreenSnapshot && (
          <div
            className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setFullscreenSnapshot(false)}
          >
            <button
              type="button"
              aria-label="Close fullscreen snapshot"
              className="absolute right-4 top-4 z-10 rounded-md bg-background/90 p-2"
              onClick={() => setFullscreenSnapshot(false)}
            >
              ×
            </button>
            <img
              src={`/api/snapshots/trade/${encodeURIComponent(trade.key)}`}
              alt="TradingView snapshot fullscreen"
              onError={() => {
                setSnapshotLoadError(true);
                setFullscreenSnapshot(false);
              }}
              className="max-h-full max-w-full object-contain"
              onClick={(event) => {
                event.stopPropagation();
                setFullscreenSnapshot(false);
              }}
            />
          </div>
        )}
      </div>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="break-words">{value}</div>
    </div>
  );
}
