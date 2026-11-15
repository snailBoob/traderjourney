"use client";

import { dateKey, rulesFollowedPercent } from "./format";
import { MissedTradeEditor } from "./missed-trade-editor";
import { MissedTradesTable } from "./missed-trades-table";
import { type Missed, type Playbook } from "./types";

import { FilterBar, useFilters } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { postJson, useApi } from "@/lib/use-api";
import { Columns3, Plus, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

export default function MissedPage() {
  return (
    <Suspense>
      <MissedContent />
    </Suspense>
  );
}

function MissedContent() {
  const { query: filterQuery, values: filterValues } = useFilters("missed");
  const { data, error, refresh } = useApi<{ trades: Missed[] }>(
    `/api/workspace/missed?${filterQuery}`,
  );
  const { data: books } = useApi<{ playbooks: Playbook[] }>("/api/playbooks");
  const [editorRequest, setEditorRequest] = useState<{
    trade?: Missed;
    focus: "note" | "snapshot" | null;
  } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingSavedEntry, setPendingSavedEntry] = useState<{
    symbol: string;
    observedAt: string;
  } | null>(null);
  const [failure, setFailure] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Missed | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingSavedEntry || !data) return;
    const savedEntry = data.trades.find(
      (trade) =>
        trade.symbol.toUpperCase() === pendingSavedEntry.symbol.toUpperCase() &&
        dateKey(trade.observedAt) === pendingSavedEntry.observedAt,
    );
    if (savedEntry) {
      setExpanded(savedEntry.id);
      setPendingSavedEntry(null);
    }
  }, [data, pendingSavedEntry]);
  const [showColumns, setShowColumns] = useState(false);
  const columnTriggerRef = useRef<HTMLDivElement>(null);

  const playbookName = (id: string | null) =>
    books?.playbooks.find((book) => book.id === id)?.name ?? "—";
  const selectedStrategyName = filterValues.playbookId
    ? playbookName(filterValues.playbookId)
    : "All strategies";

  const { data: annotationSuggestions, refresh: refreshAnnotationSuggestions } = useApi<{
    tags: string[];
  }>("/api/trades/annotation-suggestions");
  const tagSuggestions = annotationSuggestions?.tags ?? [];

  const rangeFilteredRows = data?.trades ?? [];

  const totals = useMemo(() => {
    const total = rangeFilteredRows.length;
    const back = rangeFilteredRows.filter((row) => row.outcome === "back_to_entry").length;
    const extended = rangeFilteredRows.filter((row) => row.outcome === "extended_to_2r").length;
    const assessedRows = rangeFilteredRows.filter((row) => row.ruleReview.assessed > 0);
    const averageRulesFollowed = assessedRows.length
      ? Math.round(
          assessedRows.reduce((sum, row) => sum + (rulesFollowedPercent(row) ?? 0), 0) /
            assessedRows.length,
        )
      : null;
    return {
      total,
      backPercent: total ? Math.round((back / total) * 100) : 0,
      extendedPercent: total ? Math.round((extended / total) * 100) : 0,
      rulesFollowedPercent: averageRulesFollowed,
    };
  }, [rangeFilteredRows]);

  function edit(trade?: Missed, requestedFocus: "note" | "snapshot" | null = null) {
    setFailure("");
    setEditorRequest({ trade, focus: requestedFocus });
  }

  return (
    <div>
      <FilterBar
        title="Missed trades"
        scope="missed"
        showSync
        actions={
          <div ref={columnTriggerRef}>
            <Button variant="outline" size="sm" onClick={() => setShowColumns((value) => !value)}>
              <Columns3 />
              Columns
            </Button>
          </div>
        }
        primaryAction={
          <Button
            size="sm"
            className="bg-black text-white hover:bg-black/90 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-black"
            onClick={() => edit()}
          >
            <Plus />
            Add missed trade
          </Button>
        }
      />

      <div className="space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Number of missed trades</CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold tnum">{totals.total}</span>
              <span className="ml-2 text-xs text-muted-foreground">{selectedStrategyName}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Back to entry %</CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold tnum">{totals.backPercent}%</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Extended to 2R %</CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold tnum">{totals.extendedPercent}%</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Rules followed %</CardTitle>
            </CardHeader>
            <CardContent>
              <span className="text-xl font-semibold tnum">
                {totals.rulesFollowedPercent === null ? "–" : `${totals.rulesFollowedPercent}%`}
              </span>
            </CardContent>
          </Card>
        </div>

        <MissedTradesTable
          data={data}
          books={books}
          filterQuery={filterQuery}
          expanded={expanded}
          setExpanded={setExpanded}
          showColumns={showColumns}
          setShowColumns={setShowColumns}
          columnTriggerRef={columnTriggerRef}
          edit={edit}
          setDeleteTarget={setDeleteTarget}
          setFullscreenId={setFullscreenId}
        >
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {failure}
            </p>
          )}
        </MissedTradesTable>

        {fullscreenId && (
          <div
            className="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setFullscreenId(null)}
          >
            <button
              type="button"
              aria-label="Close fullscreen screenshot"
              className="absolute right-4 top-4 z-10 rounded-md bg-background/90 p-2"
              onClick={() => setFullscreenId(null)}
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={`/api/snapshots/missed/${encodeURIComponent(fullscreenId)}`}
              alt="TradingView snapshot fullscreen"
              className="max-h-full max-w-full object-contain"
              onClick={(event) => {
                event.stopPropagation();
                setFullscreenId(null);
              }}
            />
          </div>
        )}

        <Dialog
          open={deleteTarget !== null}
          onOpenChange={(next) => !next && !deleteBusy && setDeleteTarget(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete missed trade?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Delete <strong>{deleteTarget?.symbol}</strong>? This permanently removes the missed
              trade and its stored screenshot.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteBusy || !deleteTarget}
                onClick={async () => {
                  if (!deleteTarget) return;
                  setDeleteBusy(true);
                  try {
                    await postJson(
                      "/api/workspace/missed",
                      { id: deleteTarget.id, delete: true },
                      "DELETE",
                    );
                    setDeleteTarget(null);
                    setExpanded(null);
                    refresh();
                    refreshAnnotationSuggestions();
                  } catch (e) {
                    setFailure(String(e));
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {editorRequest && (
          <MissedTradeEditor
            trade={editorRequest.trade}
            focusTarget={editorRequest.focus}
            books={books}
            tagSuggestions={tagSuggestions}
            failure={failure}
            setFailure={setFailure}
            onClose={() => setEditorRequest(null)}
            onSaved={(savedId, entry) => {
              refreshAnnotationSuggestions();
              if (savedId) {
                setExpanded(savedId);
                setPendingSavedEntry(null);
              } else setPendingSavedEntry(entry);
              refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
