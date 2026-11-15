"use client";

import { Markdown } from "@/components/rich-editor";
import { Button } from "@/components/ui/button";
import { publishHeaderNotice } from "@/lib/header-notice";
import { Share2 } from "lucide-react";
import { rulesFollowedPercent } from "./format";
import { type Missed } from "./types";
export function ExpandedMissedTrade({
  trade,
  strategyName,
  edit,
  setDeleteTarget,
  setFullscreenId,
}: {
  trade: Missed;
  strategyName: string;
  edit: (trade?: Missed, focus?: "note" | "snapshot" | null) => void;
  setDeleteTarget: (trade: Missed) => void;
  setFullscreenId: (id: string | null) => void;
}) {
  async function share(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      publishHeaderNotice("URL copied to clipboard");
    } catch {
      publishHeaderNotice("Could not copy the TradingView URL.");
    }
  }

  const statusLabel = (followed: boolean | null) =>
    followed === true ? "Followed" : followed === false ? "Broken" : "Not assessed";
  return (
    <>
      {" "}
      <div className="mb-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!trade.tradingViewUrl}
          onClick={(event) => {
            event.stopPropagation();
            if (trade.tradingViewUrl) share(trade.tradingViewUrl);
          }}
        >
          <Share2 />
          Share
        </Button>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              edit(trade);
            }}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setDeleteTarget(trade);
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="flex h-full min-h-0 flex-col gap-2">
          {trade.snapshotAttachmentId ? (
            <button
              type="button"
              className="card-sheen flex min-h-48 w-full flex-1 flex-col items-center justify-center cursor-zoom-in overflow-hidden rounded-xl border border-border/70 bg-card p-4 text-card-foreground"
              onClick={(event) => {
                event.stopPropagation();
                setFullscreenId(trade.snapshotAttachmentId);
              }}
            >
              <div className="w-full text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Snapshot
              </div>
              <div className="mt-3 flex min-h-0 flex-1 items-center justify-center">
                <img
                  src={`/api/snapshots/missed/${encodeURIComponent(trade.id)}`}
                  alt="TradingView snapshot"
                  className="block max-h-[28rem] max-w-full object-contain"
                />
              </div>
            </button>
          ) : (
            <button
              type="button"
              className="card-sheen flex h-full min-h-48 w-full flex-1 flex-col items-center justify-center rounded-xl border border-border/70 bg-card p-4 text-sm text-card-foreground"
              onClick={(event) => {
                event.stopPropagation();
                edit(trade, "snapshot");
              }}
            >
              <div className="w-full text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Snapshot
              </div>
              <div className="flex flex-1 items-center justify-center text-center">
                Add a TradingView snapshot using <span className="ml-1 underline">Edit</span>
              </div>
            </button>
          )}
        </div>
        <div className="min-w-0 flex flex-col gap-2">
          <div
            className={`card-sheen min-h-24 flex-1 rounded-xl border border-border/70 bg-card p-4 text-sm leading-6 text-card-foreground ${trade.notes ? "" : "flex flex-col justify-center text-center"}`}
          >
            <div className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Note
            </div>
            <div className={`mt-3 ${trade.notes ? "" : "flex flex-1 items-center justify-center"}`}>
              {trade.notes ? (
                <Markdown>{trade.notes}</Markdown>
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground"
                  onClick={(event) => {
                    event.stopPropagation();
                    edit(trade, "note");
                  }}
                >
                  Add a note using <span className="underline">Edit</span>
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="min-w-0 flex flex-col gap-2">
          <div className="card-sheen min-w-0 flex flex-1 flex-col rounded-xl border border-border/70 bg-card p-4 text-sm text-card-foreground">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Strategy Rule Review
            </div>
            {!trade.playbookId ? (
              <div className="flex min-h-24 flex-1 items-center justify-center text-center text-sm leading-6 text-muted-foreground">
                No strategy selected
              </div>
            ) : (
              <>
                <div className="mt-3 font-medium">{strategyName}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {trade.ruleReview.assessed > 0
                    ? `${rulesFollowedPercent(trade) ?? 0}% followed · ${trade.ruleReview.assessed}/${trade.ruleReview.total} rules assessed`
                    : `0/${trade.ruleReview.total} rules assessed`}
                </div>
                <div className="mt-3 border-t pt-1">
                  {trade.ruleChecks.length ? (
                    trade.ruleChecks.map((check) => (
                      <div
                        key={check.rule}
                        className="flex items-start justify-between gap-3 py-2.5"
                      >
                        <span className="min-w-0">{check.rule}</span>
                        <span
                          className={`shrink-0 ${check.followed === true ? "text-profit" : check.followed === false ? "text-destructive" : "text-muted-foreground"}`}
                        >
                          {statusLabel(check.followed)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="py-3 text-xs text-muted-foreground">
                      No rules configured for this Strategy.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
