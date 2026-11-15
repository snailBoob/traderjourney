"use client";

import Link from "next/link";
import { Fragment } from "react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createSortedRowModel,
  rowSortingFeature,
  columnVisibilityFeature,
  tableFeatures,
  useTable,
  sortFns,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronUp,
  Columns3,
  FileImage,
  GripVertical,
} from "lucide-react";
import { dayKeyOf, type TradeMetrics } from "@traderjourney/core";
import { FilterBar, useFilters } from "@/components/filter-bar";
import { AddTradeDialog } from "@/components/add-trade-dialog";
import { Pnl } from "@/components/pnl";
import { MonetaryValue } from "@/components/privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import Loading from "@/app/loading";
import { postJson, useApi } from "@/lib/use-api";
import { publishHeaderNotice } from "@/lib/header-notice";
import { saveUiPreference, useUiPreferences } from "@/lib/ui-preferences-client";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn, fmtDuration, fmtFee, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import { formatTimestamp } from "@/lib/timezone";
import { ExpandedTrade } from "@/components/expanded-trade";
import { AdaptiveEntryRow } from "@/components/adaptive-entry-row";
import { AdaptiveEntryTable } from "@/components/adaptive-entry-table";
import { ColumnPanel } from "@/components/column-panel";
import { ExcursionCell } from "@/components/excursion-cell";
import type { ExcursionView } from "@/lib/excursions";

interface TradeRow {
  excursion?: ExcursionView;
  key: string;
  accountId: string;
  symbol: string;
  account: string;
  direction: "long" | "short";
  status: string;
  openedAt: string;
  closedAt: string | null;
  quantity: number;
  avgEntry: number;
  avgExit: number | null;
  grossPnl: number;
  fees: number;
  netPnl: number;
  executionCount: number;
  durationMs: number | null;
  rating: number | null;
  tags: string[];
  mistakes: string[];
  reviewed: boolean;
  netEntryNotional: number | null;
  plannedR: number | null;
  realizedR: number | null;
  totalPossibleR: number | null;
  hasSnapshot: boolean;
}

const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

const EMPTY_TRADES: TradeRow[] = [];

function SortableTradeColumn({
  id,
  label,
  visible,
  onVisible,
}: {
  id: string;
  label: string;
  visible: boolean;
  onVisible: (value: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 ${isDragging ? "opacity-60" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="touch-none flex h-7 w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${label}`}
        title={`Drag to reorder ${label}`}
      >
        <GripVertical className="size-4" />
      </button>
      <Checkbox checked={visible} onCheckedChange={(value) => onVisible(value === true)} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export default function TradesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Trades />
    </Suspense>
  );
}

function Trades() {
  const { query } = useFilters();
  const { data, error, refresh } = useApi<{
    trades: TradeRow[];
    metrics: TradeMetrics;
    timeZone: string;
  }>(`/api/trades?view=list&${query}`);
  const { refresh: refreshSync } = useApi<{ lastSyncAt: string | null }>("/api/sync");
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedExpandedKey = searchParams.get("expand");
  const [expanded, setExpanded] = useState<string | null>(requestedExpandedKey);
  const [expandedRefreshToken, setExpandedRefreshToken] = useState(0);
  const [editRequestedKey, setEditRequestedKey] = useState<string | null>(null);
  const [editFocusTarget, setEditFocusTarget] = useState<"note" | "snapshot" | null>(null);
  // The URL is the durable source for direct links/edit flows. Depend only on
  // the URL value: a local row toggle must not be overwritten by the previous
  // query value while router.replace is still being applied.
  useEffect(() => {
    setExpanded(requestedExpandedKey);
  }, [requestedExpandedKey]);
  const toggleExpandedTrade = (tradeKey: string) => {
    const nextKey = expanded === tradeKey ? null : tradeKey;
    setExpanded(nextKey);
    const next = new URLSearchParams(searchParams.toString());
    if (nextKey) next.set("expand", nextKey);
    else next.delete("expand");
    const serialized = next.toString();
    window.history.replaceState(null, "", serialized ? `/trades?${serialized}` : "/trades");
  };
  const requestEditTrade = (tradeKey: string, focusTarget: "note" | "snapshot" | null = null) => {
    setExpanded(tradeKey);
    const next = new URLSearchParams(searchParams.toString());
    next.set("expand", tradeKey);
    router.replace(`/trades?${next.toString()}`, { scroll: false });
    setEditFocusTarget(focusTarget);
    setEditRequestedKey(tradeKey);
  };
  const timeZone = data?.timeZone ?? "UTC";
  const [page, setPage] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const showSyncMessage = (message: string) => publishHeaderNotice(message);
  const [showColumns, setShowColumns] = useState(false);
  const columnTriggerRef = useRef<HTMLDivElement>(null);
  const columnPanelRef = useRef<HTMLDivElement>(null);
  const { data: uiPreferences } = useUiPreferences();
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const pageSize = 50;
  useEffect(() => setPage(0), [query]);
  useEffect(() => {
    if (!showColumns) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (columnTriggerRef.current?.contains(target) || columnPanelRef.current?.contains(target))
      )
        return;
      setShowColumns(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [showColumns]);

  const columns = useMemo<ColumnDef<typeof features, TradeRow>[]>(
    () => [
      {
        id: "closedAt",
        accessorKey: "closedAt",
        header: "Close date",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {getValue<string | null>() ? dayKeyOf(getValue<string>(), timeZone) : "open"}
          </span>
        ),
      },
      {
        id: "symbol",
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      },
      {
        id: "direction",
        accessorKey: "direction",
        header: "Direction",
        cell: ({ getValue }) => <span className="capitalize">{getValue<string>()}</span>,
      },
      {
        id: "account",
        accessorKey: "account",
        header: "Account",
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Win/Loss",
        cell: ({ getValue }) => {
          const status = getValue<string>();
          return (
            <Badge variant={status === "win" ? "profit" : status === "loss" ? "loss" : "secondary"}>
              {status.toUpperCase()}
            </Badge>
          );
        },
      },
      {
        id: "quantity",
        accessorKey: "quantity",
        header: "Volume",
        cell: ({ getValue }) => <span className="tnum">{fmtNumber(getValue<number>(), 4)}</span>,
      },
      {
        id: "avgEntry",
        accessorKey: "avgEntry",
        header: "Entry",
        cell: ({ getValue }) => (
          <span className="tnum">
            <MonetaryValue>{fmtNumber(getValue<number>(), 6)}</MonetaryValue>
          </span>
        ),
      },
      {
        id: "avgExit",
        accessorKey: "avgExit",
        header: "Exit",
        cell: ({ getValue }) => (
          <span className="tnum">
            <MonetaryValue>
              {getValue<number | null>() === null ? "—" : fmtNumber(getValue<number>()!, 6)}
            </MonetaryValue>
          </span>
        ),
      },
      {
        id: "grossPnl",
        accessorKey: "grossPnl",
        header: "Gross",
        cell: ({ getValue }) => <Pnl value={getValue<number>()} />,
      },
      {
        id: "netEntryNotional",
        accessorKey: "netEntryNotional",
        header: "Net / entry notional",
        cell: ({ getValue }) => (
          <span className="tnum">
            {getValue<number | null>() == null ? "—" : fmtPercent(getValue<number>()!, 2)}
          </span>
        ),
      },
      {
        id: "plannedR",
        accessorKey: "plannedR",
        header: "Planned R",
        cell: ({ getValue }) => (
          <span className="tnum">
            {getValue<number | null>() == null
              ? "—"
              : getValue<number>()!.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
          </span>
        ),
      },
      {
        id: "realizedR",
        accessorKey: "realizedR",
        header: "Realized R",
        cell: ({ getValue }) => {
          const value = getValue<number | null>();
          return (
            <span className="tnum">
              {value == null
                ? "—"
                : `${value > 0 ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(2)}`}
            </span>
          );
        },
      },
      {
        id: "excursion",
        accessorKey: "excursion",
        header: "MAE/MFE",
        enableSorting: false,
        cell: ({ row }) => <ExcursionCell value={row.original.excursion} />,
      },
      {
        id: "totalPossibleR",
        accessorKey: "totalPossibleR",
        header: "Total possible R",
        cell: ({ getValue }) => {
          const value = getValue<number | null>();
          return <span className="tnum">{value == null ? "—" : value.toFixed(2)}</span>;
        },
      },
      {
        id: "netPnl",
        accessorKey: "netPnl",
        header: "Net P&L",
        cell: ({ getValue }) => <Pnl value={getValue<number>()} />,
      },
      {
        id: "roi",
        accessorFn: (row) =>
          row.avgEntry * row.quantity > 0 ? row.netPnl / (row.avgEntry * row.quantity) : 0,
        header: "Net ROI",
        cell: ({ getValue }) => <span className="tnum">{fmtPercent(getValue<number>(), 2)}</span>,
      },
      {
        id: "fees",
        accessorKey: "fees",
        header: "Fees",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">
            <MonetaryValue>{fmtFee(getValue<number>())}</MonetaryValue>
          </span>
        ),
      },
      {
        id: "durationMs",
        accessorKey: "durationMs",
        header: "Duration",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{fmtDuration(getValue<number | null>())}</span>
        ),
      },
      {
        id: "executionCount",
        accessorKey: "executionCount",
        header: "Execs",
        cell: ({ getValue }) => (
          <span className="tnum text-muted-foreground">{getValue<number>()}</span>
        ),
      },
      {
        id: "snapshotIndicator",
        accessorKey: "hasSnapshot",
        header: "",
        enableSorting: false,
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <FileImage
              className="mx-auto size-4 text-muted-foreground"
              aria-label="Snapshot saved"
            />
          ) : null,
      },
      {
        id: "tags",
        accessorKey: "tags",
        enableSorting: false,
        header: "Tags",
        cell: ({ getValue }) => {
          const tags = getValue<string[]>();
          return tags.length ? (
            <span className="flex max-w-40 flex-wrap gap-1">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        id: "rating",
        accessorKey: "rating",
        header: "Rating",
        cell: ({ getValue }) => {
          const rating = getValue<number | null>();
          return (
            <span className="text-muted-foreground">
              {rating === null ? "—" : "★".repeat(rating)}
            </span>
          );
        },
      },
      {
        id: "reviewed",
        accessorKey: "reviewed",
        header: "Reviewed",
        cell: ({ getValue }) =>
          getValue<boolean>() ? (
            <Check className="h-4 w-4 text-profit" />
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [timeZone],
  );

  const defaultColumnOrder = useMemo(() => {
    const preferred = [
      "symbol",
      "direction",
      "account",
      "netPnl",
      "status",
      "grossPnl",
      "fees",
      "quantity",
      "avgEntry",
      "avgExit",
      "durationMs",
      "netEntryNotional",
      "plannedR",
      "realizedR",
      "excursion",
      "totalPossibleR",
    ];
    return [
      ...preferred,
      ...columns
        .map((column) => String(column.id))
        .filter((id) => id !== "snapshotIndicator" && !preferred.includes(id)),
    ];
  }, [columns]);
  useEffect(() => {
    if (!defaultColumnOrder.length) return;
    const saved = uiPreferences?.preferences.tradesColumnOrder;
    if (Array.isArray(saved)) {
      const valid = saved.filter(
        (id): id is string =>
          typeof id === "string" && id !== "snapshotIndicator" && defaultColumnOrder.includes(id),
      );
      setColumnOrder([...valid, ...defaultColumnOrder.filter((id) => !valid.includes(id))]);
    } else {
      setColumnOrder(defaultColumnOrder);
    }
  }, [uiPreferences?.preferences.tradesColumnOrder, defaultColumnOrder]);
  const orderedColumns = useMemo(() => {
    const ordered = (columnOrder.length ? columnOrder : defaultColumnOrder)
      .map((id) => columns.find((column) => column.id === id))
      .filter((column): column is ColumnDef<typeof features, TradeRow> => Boolean(column));
    const snapshotColumn = columns.find((column) => column.id === "snapshotIndicator");
    return snapshotColumn ? [...ordered, snapshotColumn] : ordered;
  }, [columnOrder, defaultColumnOrder, columns]);
  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((current) => {
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      void saveUiPreference("tradesColumnOrder", next);
      return next;
    });
  };

  const dateSortedTrades = useMemo(
    () =>
      [...(data?.trades ?? EMPTY_TRADES)].sort(
        (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt) || b.key.localeCompare(a.key),
      ),
    [data?.trades],
  );
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    roi: false,
    executionCount: false,
    tags: false,
    rating: false,
    reviewed: false,
    closedAt: false,
    snapshotIndicator: true,
  });
  useEffect(() => {
    const saved = uiPreferences?.preferences.tradesColumnVisibility;
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      setColumnVisibility({ ...(saved as Record<string, boolean>), snapshotIndicator: true });
    else
      setColumnVisibility({
        roi: false,
        executionCount: false,
        tags: false,
        rating: false,
        reviewed: false,
        closedAt: false,
        snapshotIndicator: true,
      });
  }, [uiPreferences?.preferences.tradesColumnVisibility]);
  const table = useTable({
    features,
    columns: orderedColumns,
    data: dateSortedTrades,
    getRowId: (row) => row.key,
    state: { columnVisibility },
    onColumnVisibilityChange: (updater) => {
      setColumnVisibility((current) => {
        const next = {
          ...(typeof updater === "function" ? updater(current) : updater),
          snapshotIndicator: true,
        };
        void saveUiPreference("tradesColumnVisibility", next);
        return next;
      });
    },
  });

  const sortedRows = table.getRowModel().rows;
  useEffect(() => {
    if (!requestedExpandedKey || !sortedRows.length) return;
    const index = sortedRows.findIndex((row) => row.original.key === requestedExpandedKey);
    if (index >= 0) {
      setPage(Math.floor(index / pageSize));
      setExpanded(requestedExpandedKey);
    }
  }, [requestedExpandedKey, data?.trades]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  // Match Missed Trades: keep the expanded row and rows above it visible,
  // but hide following rows until the expanded row is closed.
  const expandedIndex = expanded
    ? visibleRows.findIndex((row) => row.original.key === expanded)
    : -1;
  const rowsToRender = visibleRows;
  const sync = async () => {
    setSyncing(true);
    try {
      const result = await postJson<{
        inserted: number;
        corrected: number;
        newTrades: number;
        failedAccounts: number;
        skipped: number;
      }>("/api/sync", {});
      refresh();
      refreshSync();
      if (result.failedAccounts > 0) {
        showSyncMessage(
          `Sync completed — ${result.newTrades} new trade${result.newTrades === 1 ? "" : "s"}${result.corrected ? `, ${result.corrected} corrected fills` : ""}${result.skipped ? `, ${result.skipped} skipped` : ""}; ${result.failedAccounts} account(s) failed`,
        );
      } else if (result.corrected > 0) {
        showSyncMessage(
          `Sync complete — ${result.inserted} new fills, ${result.corrected} corrected fills`,
        );
      } else if (result.inserted > 0) {
        showSyncMessage(
          `Sync complete — ${result.newTrades} new trade${result.newTrades === 1 ? "" : "s"}`,
        );
      } else {
        showSyncMessage("Sync complete — no new data");
      }
    } catch (cause) {
      showSyncMessage(cause instanceof Error ? cause.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const m = data?.metrics;
  return (
    <div>
      <FilterBar
        title="Trades"
        scope="standard"
        showSync
        showEditToday
        onSync={sync}
        actions={
          <div ref={columnTriggerRef}>
            <Button variant="outline" size="sm" onClick={() => setShowColumns((value) => !value)}>
              <Columns3 />
              Columns
            </Button>
          </div>
        }
        primaryAction={
          <AddTradeDialog
            onSaved={(savedKey) => {
              refresh();
              if (savedKey) {
                setExpanded(savedKey);
                setExpandedRefreshToken((value) => value + 1);
                const next = new URLSearchParams(searchParams.toString());
                next.set("expand", savedKey);
                router.replace(`/trades?${next.toString()}`, { scroll: false });
              }
            }}
            query={query}
            initialEditKey={editRequestedKey}
            initialEditFocus={editFocusTarget}
            expandedTradeKey={expanded}
            onEditRequestHandled={() => {
              setEditRequestedKey(null);
              setEditFocusTarget(null);
            }}
            className="bg-black text-white hover:bg-black/90 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-black"
          />
        }
      />
      <div className="space-y-3 p-4">
        {m && (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Net cumulative P&L</CardTitle>
              </CardHeader>
              <CardContent>
                <Pnl value={m.netPnl} className="text-xl font-semibold" />
                <span className="ml-2 text-xs text-muted-foreground">{m.closedTrades} trades</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Profit factor</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">
                  {m.profitFactorIsInfinite
                    ? "∞"
                    : m.profitFactor === null
                      ? "—"
                      : fmtNumber(m.profitFactor)}
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Trade win %</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">{fmtPercent(m.winRate)}</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Avg win / loss</CardTitle>
              </CardHeader>
              <CardContent>
                <span className="text-xl font-semibold tnum">
                  {m.avgWinLossRatio === null ? "—" : fmtNumber(m.avgWinLossRatio)}
                </span>
              </CardContent>
            </Card>
          </div>
        )}

        {showColumns && (
          <ColumnPanel panelRef={columnPanelRef}>
            <Card>
              <CardContent className="space-y-3 py-3">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleColumnDragEnd}
                >
                  <SortableContext items={columnOrder} strategy={rectSortingStrategy}>
                    <div className="flex flex-wrap gap-2">
                      {columnOrder.map((id) => {
                        const column = columns.find((item) => item.id === id);
                        const label = typeof column?.header === "string" ? column.header : id;
                        const tableColumn = table
                          .getAllLeafColumns()
                          .find((item) => item.id === id);
                        return (
                          <SortableTradeColumn
                            key={id}
                            id={id}
                            label={label}
                            visible={tableColumn?.getIsVisible() ?? true}
                            onVisible={(value) => tableColumn?.toggleVisibility(value)}
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

        {error ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{error}</p>
            <Button variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        ) : !data ? (
          <Skeleton className="h-96" />
        ) : (
          <Card>
            <div className="relative min-w-0 max-w-full overflow-x-auto">
              <AdaptiveEntryTable
                className="entry-table w-full text-sm"
                columns={table
                  .getVisibleLeafColumns()
                  .filter((column) => column.id !== "snapshotIndicator")
                  .map((column) => ({
                    id: column.id,
                    label:
                      typeof column.columnDef.header === "string"
                        ? column.columnDef.header
                        : column.id,
                    onSort: column.getCanSort()
                      ? () => {
                          setPage(0);
                          column.toggleSorting();
                        }
                      : undefined,
                  }))}
              >
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id} className="border-b">
                      {headerGroup.headers.map((header) => (
                        <th
                          key={header.id}
                          className="h-9 whitespace-nowrap px-2 text-left text-xs font-medium text-muted-foreground"
                        >
                          {header.isPlaceholder ? null : header.column.getCanSort() ? (
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground"
                              onClick={(event) => {
                                setPage(0);
                                header.column.getToggleSortingHandler()?.(event);
                              }}
                            >
                              <table.FlexRender header={header} />
                              <ArrowUpDown
                                className={cn(
                                  "h-3 w-3",
                                  header.column.getIsSorted() && "text-foreground",
                                )}
                              />
                            </button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {rowsToRender.map((row, index) => {
                    const tradeKey = row.original.key;
                    const isExpanded = expanded === tradeKey;
                    return (
                      <Fragment key={row.id}>
                        <AdaptiveEntryRow
                          afterExpanded={expandedIndex >= 0 && index > expandedIndex}
                          fields={row
                            .getVisibleCells()
                            .filter((cell) => cell.column.id !== "snapshotIndicator")
                            .map((cell) => ({
                              id: cell.column.id,
                              label:
                                typeof cell.column.columnDef.header === "string"
                                  ? cell.column.columnDef.header
                                  : cell.column.id,
                              value:
                                cell.column.id !== "closedAt" && cell.getValue() == null ? (
                                  "—"
                                ) : (
                                  <table.FlexRender cell={cell} />
                                ),
                              onSort: cell.column.getCanSort()
                                ? () => {
                                    setPage(0);
                                    cell.column.toggleSorting();
                                  }
                                : undefined,
                            }))}
                          expanded={isExpanded}
                          onToggle={() => toggleExpandedTrade(tradeKey)}
                          indicator={
                            row.original.hasSnapshot ? (
                              <FileImage className="size-4" aria-label="Snapshot saved" />
                            ) : null
                          }
                        />
                        <tr
                          className={`desktop-entry-row cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50 ${expandedIndex >= 0 && index > expandedIndex ? "entry-after-expanded" : ""}`}
                          onClick={() => toggleExpandedTrade(tradeKey)}
                          aria-expanded={isExpanded}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="whitespace-nowrap px-2 py-3 align-middle">
                              {cell.column.id !== "closedAt" && cell.getValue() == null ? (
                                "—"
                              ) : (
                                <table.FlexRender cell={cell} />
                              )}
                            </td>
                          ))}
                          <td className="w-8 px-2 py-3 text-right text-muted-foreground">
                            {isExpanded ? (
                              <ChevronUp className="inline size-4" />
                            ) : (
                              <ChevronDown className="inline size-4" />
                            )}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-b bg-muted/10">
                            <td
                              colSpan={table.getVisibleLeafColumns().length + 1}
                              className="entry-detail p-3"
                            >
                              <ExpandedTrade
                                key={`${tradeKey}-${expandedRefreshToken}`}
                                tradeKey={tradeKey}
                                onEdit={(focusTarget) =>
                                  requestEditTrade(tradeKey, focusTarget ?? null)
                                }
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {table.getRowModel().rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={table.getVisibleLeafColumns().length}
                        className="py-16 text-center text-muted-foreground"
                      >
                        No trades match these filters.{" "}
                        <Link href="/import" className="underline">
                          Import some
                        </Link>
                        .
                      </td>
                    </tr>
                  )}
                </tbody>
              </AdaptiveEntryTable>
            </div>
            {sortedRows.length > pageSize && !expanded && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
                <span>
                  {currentPage * pageSize + 1}–
                  {Math.min((currentPage + 1) * pageSize, sortedRows.length)} of{" "}
                  {fmtNumber(sortedRows.length, 0)} trades
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {currentPage + 1} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage + 1 === pageCount}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
