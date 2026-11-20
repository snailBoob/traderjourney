"use client";

import { EquityArea } from "@/components/charts/equity-area";
import { ScreenshotGrid } from "@/components/journal-quick-edit-modal";
import { Pnl } from "@/components/pnl";
import { Markdown } from "@/components/rich-editor";
import { RoutineDayCell } from "@/components/routine-day-cell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { postJson } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";
import { useState } from "react";
import { TradeTable } from "./trade-table";
import type { DayPayload } from "./types";

export function ExpandedDay({
  data,
  loading,
  onEdit,
  onEditTrade,
  savedTrade,
  onRefresh,
  onDelete,
  onLightbox,
}: {
  data?: DayPayload | null;
  loading: boolean;
  onEdit: () => void;
  onEditTrade: (tradeKey: string) => void;
  savedTrade: { key: string; revision: number } | null;
  onRefresh: () => void;
  onDelete: () => void;
  onLightbox: (id: string) => void;
}) {
  if (loading || !data)
    return (
      <div className="py-4">
        <Skeleton className="h-64" />
      </div>
    );
  const hasScreenshots = data.attachments.length > 0;
  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          Edit
        </Button>
        <DeleteResetButton data={data} onRefresh={onRefresh} onDelete={onDelete} />
      </div>
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <div className="card-sheen min-w-0 self-start min-h-[242px] rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Intraday cumulative net P&amp;L
          </div>
          <div className="mt-3">
            {data.intraday.length > 0 ? (
              <EquityArea
                data={data.intraday.map((p) => ({ t: p.t.slice(11, 16), cumNetPnl: p.cumNetPnl }))}
                height={180}
              />
            ) : (
              <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
                No data available
              </div>
            )}
          </div>
        </div>
        <div className="card-sheen min-w-0 min-h-[242px] rounded-xl border border-border/70 bg-card p-4 text-card-foreground flex flex-col">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Note
          </div>
          <div
            className={`mt-3 min-h-24 flex-1 text-sm leading-6 ${data.note ? "" : "flex items-center justify-center text-center"}`}
          >
            {data.note ? (
              <Markdown>{data.note}</Markdown>
            ) : (
              <button type="button" className="text-muted-foreground" onClick={onEdit}>
                Add a note using <span className="underline">Edit</span>
              </button>
            )}
          </div>
        </div>
      </div>
      <div
        className={
          hasScreenshots
            ? "grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3"
            : "grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[1fr_2fr]"
        }
      >
        <div className="card-sheen min-w-0 h-full rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Daily Routine
          </div>
          <div className="mt-3 flex-1">
            <RoutineDisplay routine={data.routine} date={data.date} />
          </div>
        </div>
        <div className="card-sheen min-w-0 h-full rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Daily Bias
          </div>
          <div className="mt-3 flex-1">
            {data.dailyBiasPlaybooks.length ? (
              <div className="flex flex-wrap gap-1">
                {data.dailyBiasPlaybooks.map((id) => (
                  <Badge key={id} variant="secondary">
                    {data.playbooks.find((book) => book.id === id)?.name ?? id}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className="flex min-h-24 items-center justify-center text-center text-sm text-muted-foreground">
                Not available
              </div>
            )}
            {data.dailyBiasStats && (
              <div className="mt-4 grid w-full max-w-[90%] grid-cols-[40%_20%_20%_20%] items-center gap-x-0 gap-y-2 text-sm">
                <div />
                <div className="text-xs text-muted-foreground">Trades</div>
                <div className="text-xs text-muted-foreground">%</div>
                <div className="text-xs text-muted-foreground">Net P&amp;L</div>
                <div className="font-medium">According to bias</div>
                <div className="tnum !ml-0">
                  {data.dailyBiasStats.matchedTrades} / {data.dailyBiasStats.totalTrades}
                </div>
                <div className="tnum !ml-0">
                  {fmtPercent(
                    data.dailyBiasStats.totalTrades
                      ? data.dailyBiasStats.matchedTrades / data.dailyBiasStats.totalTrades
                      : null,
                    0,
                  )}
                </div>
                <div className="tnum !ml-0">
                  <Pnl value={data.dailyBiasStats.matchedPnl} className="!ml-0" />
                </div>
                <div className="font-medium">Not according to bias</div>
                <div className="tnum !ml-0">
                  {data.dailyBiasStats.notMatchedTrades} / {data.dailyBiasStats.totalTrades}
                </div>
                <div className="tnum !ml-0">
                  {fmtPercent(
                    data.dailyBiasStats.totalTrades
                      ? data.dailyBiasStats.notMatchedTrades / data.dailyBiasStats.totalTrades
                      : null,
                    0,
                  )}
                </div>
                <div className="tnum !ml-0">
                  <Pnl value={data.dailyBiasStats.notMatchedPnl} className="!ml-0" />
                </div>
              </div>
            )}
          </div>
        </div>
        {hasScreenshots && (
          <div className="card-sheen min-w-0 h-full rounded-xl border border-border/70 bg-card p-4 text-card-foreground">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Screenshots
            </div>
            <div className="mt-3">
              <ScreenshotGrid singleRow attachments={data.attachments} onLightbox={onLightbox} />
            </div>
          </div>
        )}
      </div>
      <TradeTable trades={data.trades} onEditTrade={onEditTrade} savedTrade={savedTrade} />
    </div>
  );
}

function RoutineDisplay({ routine, date }: { routine: DayPayload["routine"]; date: string }) {
  return (
    <div className="space-y-3">
      <div className="flex w-fit items-center gap-2 text-sm">
        <RoutineDayCell
          date={date}
          completed={routine.completed}
          total={routine.total}
          score={routine.score}
        />
        <span className="tnum text-xs text-muted-foreground">
          {routine.score == null ? "—" : `${fmtPercent(routine.score, 0)} completion`}
        </span>
      </div>
      {routine.routines.filter((r) => !r.done).length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Not followed:</span>
          {routine.routines
            .filter((r) => !r.done)
            .map((r) => (
              <Badge key={r.id} variant="outline">
                {r.title}
              </Badge>
            ))}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">All routines followed</div>
      )}
    </div>
  );
}

function DeleteResetButton({
  data,
  onRefresh,
  onDelete,
}: {
  data: DayPayload;
  onRefresh: () => void;
  onDelete: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const reset = data.hasAutomaticData;
  const act = async () => {
    setBusy(true);
    try {
      await postJson(`/api/journal/${data.date}`, { mode: reset ? "reset" : "delete" }, "DELETE");
      setOpen(false);
      if (!reset) onDelete();
      onRefresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => setOpen(true)}>
        {reset ? "Reset" : "Delete"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{reset ? "Reset Journal data?" : "Delete Journal day?"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {reset
              ? "This will remove the Note, Daily Bias, Routine data and screenshots for this day. Trade data and automatic Journal statistics will not be affected."
              : "This will permanently delete this manually created Journal day and all of its data."}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={act}>
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
