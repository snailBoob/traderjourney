"use client";

import { JournalRow } from "./journal-row";
import { ColumnPanel } from "@/components/column-panel";
import { AdaptiveEntryTable } from "@/components/adaptive-entry-table";
import { SortableColumnItem } from "./sortable-column-item";
import type { JournalListPayload } from "./types";

import { AddTradeDialog } from "@/components/add-trade-dialog";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { JournalQuickEditModal as JournalModal } from "@/components/journal-quick-edit-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { saveUiPreference, useUiPreferences } from "@/lib/ui-preferences-client";
import { useApi } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { dayKeyOf } from "@traderjourney/core";
import { ArrowUpDown, Columns3, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface BrokerAccountStatus {
  id: string;
  kind: "sync" | "import" | "manual";
  broker: string;
  connected: boolean;
  snapshot: { positions: unknown[]; openOrders: unknown[] } | null;
}
interface BrokerSyncFailure {
  broker: string;
  message: string;
}

const PAGE_SIZE = 50;
const COLUMN_DEFS = [
  ["date", "Date"],
  ["pnl", "Net P&L"],
  ["trades", "Trades"],
  ["winrate", "Win rate"],
  ["wl", "Win / loss"],
  ["bias", "Daily Bias"],
  ["sessionDuration", "Session duration"],
  ["routine", "Daily Routine"],
] as const;
const MOVABLE_COLUMN_IDS = COLUMN_DEFS.map(([id]) => id) as string[];
const isMovableColumnId = (id: string) => MOVABLE_COLUMN_IDS.includes(id);
const defaultColumns = new Set(MOVABLE_COLUMN_IDS);
const sortLabels = {
  date: "Date",
  pnl: "Net P&L",
  winrate: "Win rate",
  trades: "Trades",
  routine: "Daily Routine",
  sessionDuration: "Session duration",
} as const;

export default function JournalPage() {
  return (
    <Suspense fallback={<Skeleton className="m-4 h-96" />}>
      <Journal />
    </Suspense>
  );
}

function Journal() {
  const { query, timeZone } = useFilters("journal");
  const searchParams = useSearchParams();
  const { data: uiPreferences } = useUiPreferences();
  const focusDate = searchParams.get("focusDate");
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  const requestedPage = Math.max(1, Number(params?.get("page") ?? "1") || 1);
  const [page, setPage] = useState(requestedPage);
  const [sort, setSort] = useState<{ id: keyof typeof sortLabels; dir: "asc" | "desc" } | null>(
    null,
  );
  const [columnOrder, setColumnOrder] = useState<string[]>(MOVABLE_COLUMN_IDS);
  const { data, error, refresh } = useApi<JournalListPayload>(
    `/api/journal?${query}${query ? "&" : ""}page=${page}${focusDate ? `&focusDate=${encodeURIComponent(focusDate)}` : ""}${sort ? `&sortBy=${sort.id}&sortDir=${sort.dir}` : ""}`,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showColumns, setShowColumns] = useState(false);
  const journalColumnTriggerRef = useRef<HTMLDivElement>(null);
  const journalColumnPanelRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(defaultColumns);
  const [modal, setModal] = useState<{
    date: string;
    mode: "add" | "edit";
    focusNote?: boolean;
    focusSession?: boolean;
  } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);
  const [editTradeRequestedKey, setEditTradeRequestedKey] = useState<string | null>(null);
  const [savedTrade, setSavedTrade] = useState<{ key: string; revision: number } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    setPage(requestedPage);
    setExpanded(null);
  }, [query, requestedPage]);
  const focusedDateApplied = useRef<string | null>(null);
  const scrollOnExpand = useRef<string | null>(null);
  useEffect(() => {
    if (!focusDate || !data || focusedDateApplied.current === focusDate) return;
    if (data.days.some((day) => day.date === focusDate)) {
      setPage(data.pagination.page);
      scrollOnExpand.current = focusDate;
      setExpanded(focusDate);
      focusedDateApplied.current = focusDate;
      // focusDate stays in the URL: stripping it via replaceState changes the
      // list fetch key, the refetch briefly collapses the table, and the
      // browser clamps the just-applied scroll back to 0.
    }
  }, [focusDate, data, searchParams]);
  // When a day is opened through focusDate, bring its row into view just
  // below the sticky filter bar once the table has settled. Manual
  // expansions never scroll, and nothing interferes after ~1s.
  useLayoutEffect(() => {
    if (!expanded || scrollOnExpand.current !== expanded) return;
    scrollOnExpand.current = null;
    const target = expanded;
    let cancelled = false;
    const align = () => {
      const row = document.getElementById(`journal-day-${target}`);
      if (!row) return;
      const desktopRect = row.getBoundingClientRect();
      const rect =
        desktopRect.height > 0
          ? desktopRect
          : document.getElementById(`journal-day-mobile-${target}`)?.getBoundingClientRect();
      if (!rect) return;
      if (rect.height <= 0) return;
      const bar = document.querySelector(".journal-filter-bar");
      const stickyHeader =
        bar && getComputedStyle(bar).position === "sticky"
          ? bar
          : document.querySelector(".journal-page-title-sticky");
      const offset = stickyHeader ? Math.max(0, stickyHeader.getBoundingClientRect().bottom) : 0;
      window.scrollTo(0, rect.top + window.scrollY - offset);
    };
    const timers = [400, 1000].map((delay) =>
      window.setTimeout(() => {
        if (!cancelled) align();
      }, delay),
    );
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [expanded]);
  useEffect(() => {
    if (!showColumns) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (journalColumnTriggerRef.current?.contains(target) ||
          journalColumnPanelRef.current?.contains(target))
      )
        return;
      setShowColumns(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [showColumns]);
  useEffect(() => {
    const saved = uiPreferences?.preferences.journalColumnOrder;
    if (Array.isArray(saved)) {
      const valid = saved.filter(
        (id): id is string => typeof id === "string" && isMovableColumnId(id),
      );
      setColumnOrder([...valid, ...MOVABLE_COLUMN_IDS.filter((id) => !valid.includes(id))]);
    }
  }, [uiPreferences?.preferences.journalColumnOrder]);
  const orderedColumnIds = useMemo(
    () => columnOrder.filter((id) => isMovableColumnId(id)),
    [columnOrder],
  );
  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((current) => {
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      void saveUiPreference("journalColumnOrder", next);
      return next;
    });
  };
  const toggleSort = (id: keyof typeof sortLabels) => {
    setPage(1);
    setSort((current) =>
      current?.id === id ? { id, dir: current.dir === "asc" ? "desc" : "asc" } : { id, dir: "asc" },
    );
    setExpanded(null);
  };
  const pageData = data?.pagination;

  const setPageUrl = (nextPage: number) => {
    const url = new URL(window.location.href);
    if (nextPage <= 1) url.searchParams.delete("page");
    else url.searchParams.set("page", String(nextPage));
    window.history.replaceState(null, "", url.toString());
    setPage(nextPage);
    refresh();
  };

  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const openToday = () => {
    setModal({
      date: today,
      mode: data?.existingDates.includes(today) ? "edit" : "add",
      focusSession: true,
    });
  };
  const hadEditToday = useRef(false);
  const clearEditTodayQuery = () => {
    const next = new URL(window.location.href);
    next.searchParams.delete("edit");
    window.history.replaceState(null, "", next.toString());
    hadEditToday.current = false;
  };
  useEffect(() => {
    if (searchParams.get("edit") === "today" && data) {
      hadEditToday.current = true;
      openToday();
    } else if (searchParams.get("edit") !== "today" && hadEditToday.current) {
      hadEditToday.current = false;
      setModal(null);
    }
  }, [searchParams, data]);

  return (
    <div>
      <FilterBar
        title="Daily Journal"
        scope="journal"
        showSync
        showEditToday
        actions={
          <div ref={journalColumnTriggerRef}>
            <Button variant="outline" size="sm" onClick={() => setShowColumns((value) => !value)}>
              <Columns3 />
              Columns
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
        <Summary
          title="Consecutive winning days"
          value={String(data?.summary.consecutiveWinningDays ?? "–")}
        />
        <Summary
          title="Consecutive losing days"
          value={String(data?.summary.consecutiveLosingDays ?? "–")}
        />
        <Summary
          title="According to Daily Bias"
          value={
            data?.summary.accordingToDailyBias == null
              ? "–"
              : fmtPercent(data.summary.accordingToDailyBias, 0)
          }
        />
        <Summary
          title="Routine completion"
          value={
            data?.summary.routineCompletion == null
              ? "–"
              : fmtPercent(data.summary.routineCompletion, 0)
          }
        />
      </div>
      <div className="space-y-3 px-4 pb-4">
        {showColumns && (
          <ColumnPanel panelRef={journalColumnPanelRef}>
            <Card>
              <CardContent className="space-y-3 py-3">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleColumnDragEnd}
                >
                  <SortableContext items={orderedColumnIds} strategy={rectSortingStrategy}>
                    <div className="flex flex-wrap gap-2">
                      {orderedColumnIds.map((id) => {
                        const label = COLUMN_DEFS.find(([columnId]) => columnId === id)?.[1] ?? id;
                        return (
                          <SortableColumnItem
                            key={id}
                            id={id}
                            label={label}
                            visible={columns.has(id)}
                            onVisible={(value) =>
                              setColumns((current) => {
                                const next = new Set(current);
                                if (value) next.add(id);
                                else next.delete(id);
                                return next;
                              })
                            }
                          />
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </CardContent>
            </Card>
          </ColumnPanel>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!data ? (
          <Skeleton className="h-64" />
        ) : data.days.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No Journal days match the current filters.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <AdaptiveEntryTable
              className="entry-table w-full min-w-[1100px] table-fixed text-sm"
              columns={orderedColumnIds
                .filter((id) => columns.has(id))
                .map((id) => ({
                  id,
                  label: COLUMN_DEFS.find(([key]) => key === id)?.[1] ?? id,
                  onSort:
                    id in sortLabels ? () => toggleSort(id as keyof typeof sortLabels) : undefined,
                }))}
            >
              <colgroup>
                {orderedColumnIds.map((id) => (
                  <col key={id} style={{ display: columns.has(id) ? undefined : "none" }} />
                ))}
                <col className="w-12" />
                <col className="w-12" />
              </colgroup>
              <thead>
                <tr className="border-b">
                  {orderedColumnIds.map((id) => {
                    const label = COLUMN_DEFS.find(([columnId]) => columnId === id)?.[1] ?? id;
                    const sortable = id in sortLabels;
                    const active = sort?.id === id;
                    return columns.has(id) ? (
                      <th
                        key={id}
                        className="h-9 whitespace-nowrap px-2 text-left text-xs font-medium text-muted-foreground"
                      >
                        {sortable ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => toggleSort(id as keyof typeof sortLabels)}
                          >
                            {label}
                            <ArrowUpDown className={`h-3 w-3 ${active ? "text-foreground" : ""}`} />
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    ) : null;
                  })}
                  <th className="w-12 h-9 whitespace-nowrap px-2 text-left text-xs font-medium text-muted-foreground" />
                  <th className="w-12 h-9 px-2" />
                </tr>
              </thead>
              <tbody>
                {data.days.map((day, index) => (
                  <JournalRow
                    key={day.date}
                    day={day}
                    expanded={expanded === day.date}
                    anyExpanded={expanded !== null}
                    afterExpanded={
                      expanded !== null &&
                      data.days.findIndex((item) => item.date === expanded) >= 0 &&
                      index > data.days.findIndex((item) => item.date === expanded)
                    }
                    columns={columns}
                    columnOrder={orderedColumnIds}
                    columnLabels={Object.fromEntries(COLUMN_DEFS)}
                    sortColumn={(id) =>
                      id in sortLabels ? () => toggleSort(id as keyof typeof sortLabels) : undefined
                    }
                    onToggle={() =>
                      setExpanded((current) => (current === day.date ? null : day.date))
                    }
                    onEdit={() => setModal({ date: day.date, mode: "edit", focusNote: true })}
                    onRefresh={refresh}
                    onDelete={() => setExpanded(null)}
                    onLightbox={setLightbox}
                    strategyNames={data.strategies}
                    detailRefreshToken={detailRefreshToken}
                    onEditTrade={setEditTradeRequestedKey}
                    savedTrade={savedTrade}
                  />
                ))}
              </tbody>
            </AdaptiveEntryTable>
          </div>
        )}
        {pageData && pageData.total > PAGE_SIZE && !expanded && (
          <div className="flex items-center justify-between gap-3 py-3 text-xs text-muted-foreground">
            <span>
              {pageData.from}–{pageData.to} of {pageData.total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={pageData.page <= 1}
                onClick={() => setPageUrl(pageData.page - 1)}
              >
                Previous
              </Button>
              <span>
                Page {pageData.page} of {pageData.totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={pageData.page >= pageData.totalPages}
                onClick={() => setPageUrl(pageData.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
      {modal && (
        <JournalModal
          focusNote={Boolean(modal.focusNote)}
          focusSession={Boolean(modal.focusSession)}
          date={modal.date}
          mode={modal.mode}
          existingDates={data?.existingDates ?? []}
          timeZone={timeZone}
          onClose={() => {
            setModal(null);
            clearEditTodayQuery();
          }}
          onSaved={() => {
            const savedDate = modal.date;
            setModal(null);
            clearEditTodayQuery();
            setExpanded(savedDate);
            setDetailRefreshToken((value) => value + 1);
            refresh();
          }}
        />
      )}
      <AddTradeDialog
        className="hidden"
        initialEditKey={editTradeRequestedKey}
        expandedTradeKey={editTradeRequestedKey}
        onEditRequestHandled={() => setEditTradeRequestedKey(null)}
        onSaved={(savedTradeKey) => {
          if (savedTradeKey)
            setSavedTrade((current) => ({
              key: savedTradeKey,
              revision: (current?.revision ?? 0) + 1,
            }));
          setDetailRefreshToken((value) => value + 1);
          refresh();
        }}
      />
      <Dialog open={lightbox !== null} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-6xl p-2">
          <button
            type="button"
            aria-label="Close image"
            className="absolute right-3 top-3 z-10 rounded bg-background/80 p-1"
            onClick={() => setLightbox(null)}
          >
            <X className="size-4" />
          </button>
          {lightbox && (
            <img
              src={`/api/attachments/${lightbox}`}
              alt="Journal screenshot"
              className="max-h-[85vh] w-full cursor-pointer object-contain"
              onClick={() => setLightbox(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold tnum">{value}</p>
      </CardContent>
    </Card>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="tnum text-sm">{children}</div>
    </div>
  );
}

function fmtR(value: number | null, showPositivePlus: boolean): string {
  if (value == null) return "—";
  const abs = Math.abs(value).toFixed(2);
  if (value > 0) return `${showPositivePlus ? "+" : ""}${abs}`;
  if (value < 0) return `-${abs}`;
  return `${showPositivePlus ? "+" : ""}${abs}`;
}
