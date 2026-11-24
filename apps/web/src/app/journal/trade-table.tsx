"use client";

import { ExpandedTrade } from "@/components/expanded-trade";
import { AdaptiveEntryRow } from "@/components/adaptive-entry-row";
import { AdaptiveEntryTable } from "@/components/adaptive-entry-table";
import { Pnl } from "@/components/pnl";
import { MonetaryValue } from "@/components/privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { saveUiPreference, useUiPreferences } from "@/lib/ui-preferences-client";
import { fmtDuration, fmtMoney, fmtNumber, fmtPercent } from "@/lib/utils";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy } from "@dnd-kit/sortable";
import { ChevronDown, ChevronUp, FileImage, ListOrdered } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { SortableColumnItem } from "./sortable-column-item";
import type { TradeRow } from "./types";
import { ExcursionCell } from "@/components/excursion-cell";

const JOURNAL_TRADE_COLUMNS = [
  ["closedAt", "Close date"],
  ["symbol", "Symbol"],
  ["direction", "Direction"],
  ["account", "Account"],
  ["status", "Win/Loss"],
  ["volume", "Volume"],
  ["avgEntry", "Entry"],
  ["avgExit", "Exit"],
  ["grossPnl", "Gross"],
  ["netEntryNotional", "Net / entry notional"],
  ["plannedR", "Planned R"],
  ["realizedR", "Realized R"],
  ["excursion", "MAE/MFE"],
  ["totalPossibleR", "Total possible R"],
  ["netPnl", "Net P&L"],
  ["roi", "Net ROI"],
  ["fees", "Fees"],
  ["durationMs", "Duration"],
  ["executionCount", "Execs"],
  ["tags", "Tags"],
  ["rating", "Rating"],
  ["reviewed", "Reviewed"],
] as const;
const JOURNAL_TRADE_COLUMN_IDS = JOURNAL_TRADE_COLUMNS.map(([id]) => id);

export function TradeTable({
  trades,
  onEditTrade,
  savedTrade,
}: {
  trades: TradeRow[];
  onEditTrade: (tradeKey: string) => void;
  savedTrade: { key: string; revision: number } | null;
}) {
  const { data: uiPreferences } = useUiPreferences();
  const [expandedTradeKey, setExpandedTradeKey] = useState<string | null>(null);
  useEffect(() => {
    if (savedTrade && trades.some((trade) => trade.key === savedTrade.key))
      setExpandedTradeKey(savedTrade.key);
  }, [savedTrade?.revision, savedTrade?.key, trades]);
  // Match the Trades page: keep the expanded trade and rows above it visible,
  // and hide following trades until the expanded trade is closed.
  const expandedTradeIndex = expandedTradeKey
    ? trades.findIndex((trade) => trade.key === expandedTradeKey)
    : -1;
  const tradesToRender = trades;
  const [showColumns, setShowColumns] = useState(false);
  const columnControlsRef = useRef<HTMLDivElement>(null);
  const [columnOrder, setColumnOrder] = useState<string[]>([...JOURNAL_TRADE_COLUMN_IDS]);
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(
    new Set(JOURNAL_TRADE_COLUMN_IDS),
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useEffect(() => {
    const savedOrder = uiPreferences?.preferences.journalTradesColumnOrder;
    if (Array.isArray(savedOrder)) {
      const valid = savedOrder.filter(
        (id): id is string =>
          typeof id === "string" && JOURNAL_TRADE_COLUMN_IDS.includes(id as never),
      );
      setColumnOrder([...valid, ...JOURNAL_TRADE_COLUMN_IDS.filter((id) => !valid.includes(id))]);
    }
    const savedVisibility = uiPreferences?.preferences.journalTradesColumnVisibility;
    if (savedVisibility && typeof savedVisibility === "object" && !Array.isArray(savedVisibility)) {
      const value = savedVisibility as Record<string, boolean>;
      setVisibleColumns(new Set(JOURNAL_TRADE_COLUMN_IDS.filter((id) => value[id] !== false)));
    }
  }, [
    uiPreferences?.preferences.journalTradesColumnOrder,
    uiPreferences?.preferences.journalTradesColumnVisibility,
  ]);
  useEffect(() => {
    if (!showColumns) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && columnControlsRef.current?.contains(target)) return;
      setShowColumns(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [showColumns]);
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((current) => {
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      void saveUiPreference("journalTradesColumnOrder", next);
      return next;
    });
  };
  const toggleVisible = (id: string, value: boolean) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      void saveUiPreference(
        "journalTradesColumnVisibility",
        Object.fromEntries(
          JOURNAL_TRADE_COLUMN_IDS.map((columnId) => [columnId, next.has(columnId)]),
        ),
      );
      return next;
    });
  };
  const fmtR = (value: number | null, positive: boolean) =>
    value == null
      ? "—"
      : `${value > 0 && positive ? "+" : value === 0 && positive ? "+" : value < 0 ? "-" : ""}${Math.abs(value).toFixed(2)}`;
  const cell = (id: string, t: TradeRow) => {
    switch (id) {
      case "excursion":
        return <ExcursionCell value={t.excursion} />;
      case "closedAt":
        return (
          <span className="text-muted-foreground">
            {t.closedAt ? t.closedAt.slice(0, 10) : "open"}
          </span>
        );
      case "symbol":
        return <span className="font-medium">{t.symbol}</span>;
      case "direction":
        return <span className="capitalize">{t.direction}</span>;
      case "account":
        return t.account;
      case "status":
        return (
          <Badge
            variant={t.status === "win" ? "profit" : t.status === "loss" ? "loss" : "secondary"}
          >
            {t.status.toUpperCase()}
          </Badge>
        );
      case "volume":
        return <span className="tnum">{fmtNumber(t.volume, 4)}</span>;
      case "avgEntry":
        return (
          <span className="tnum">
            <MonetaryValue>{fmtNumber(t.avgEntry, 6)}</MonetaryValue>
          </span>
        );
      case "avgExit":
        return (
          <span className="tnum">
            <MonetaryValue>{t.avgExit == null ? "—" : fmtNumber(t.avgExit, 6)}</MonetaryValue>
          </span>
        );
      case "grossPnl":
        return <Pnl value={t.grossPnl} />;
      case "netEntryNotional":
        return (
          <span className="tnum">
            {t.netEntryNotional == null ? "—" : fmtPercent(t.netEntryNotional, 2)}
          </span>
        );
      case "plannedR":
        return (
          <span className="tnum">
            {t.plannedR == null
              ? "—"
              : t.plannedR.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
          </span>
        );
      case "realizedR":
        return (
          <span className="tnum">
            {t.realizedR == null
              ? "—"
              : `${t.realizedR > 0 ? "+" : t.realizedR < 0 ? "-" : ""}${Math.abs(t.realizedR).toFixed(2)}`}
          </span>
        );
      case "totalPossibleR":
        return (
          <span className="tnum">
            {t.totalPossibleR == null ? "—" : t.totalPossibleR.toFixed(2)}
          </span>
        );
      case "netPnl":
        return <Pnl value={t.netPnl} />;
      case "roi":
        return (
          <span className="tnum">
            {fmtPercent(t.avgEntry * t.volume > 0 ? t.netPnl / (t.avgEntry * t.volume) : 0, 2)}
          </span>
        );
      case "fees":
        return (
          <span className="tnum text-muted-foreground">
            <MonetaryValue>{fmtMoney(t.fees)}</MonetaryValue>
          </span>
        );
      case "durationMs":
        return <span className="text-muted-foreground">{fmtDuration(t.durationMs)}</span>;
      case "executionCount":
        return <span className="tnum text-muted-foreground">{t.executionCount}</span>;
      case "tags":
        return t.tags.length ? (
          <span className="flex max-w-40 flex-wrap gap-1">
            {t.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      case "rating":
        return (
          <span className="text-muted-foreground">
            {t.rating == null ? "—" : "★".repeat(t.rating)}
          </span>
        );
      case "reviewed":
        return t.reviewed ? (
          <span className="text-profit">✓</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      default:
        return "—";
    }
  };
  return (
    <div className="min-w-0">
      <div ref={columnControlsRef}>
        <div className="mb-2 flex items-center gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Trades
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Reorder columns"
            aria-label="Reorder columns"
            aria-pressed={showColumns}
            className="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setShowColumns((value) => !value)}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </Button>
        </div>
        {showColumns && (
          <Card className="mb-3">
            <CardContent className="space-y-2 py-3">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={columnOrder} strategy={rectSortingStrategy}>
                  <div className="flex flex-wrap gap-2">
                    {columnOrder.map((id) => (
                      <SortableColumnItem
                        key={id}
                        id={id}
                        label={
                          JOURNAL_TRADE_COLUMNS.find(([columnId]) => columnId === id)?.[1] ?? id
                        }
                        visible={visibleColumns.has(id)}
                        onVisible={(value) => toggleVisible(id, value)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="card-sheen min-w-0 rounded-xl border border-border/70 bg-card p-4 max-lg:p-1 text-card-foreground">
        {!trades.length ? (
          <div className="flex min-h-16 items-center justify-center rounded-lg border border-border/70 bg-background p-4 text-center text-sm text-muted-foreground">
            No trades for this day.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/70 bg-background">
            <AdaptiveEntryTable
              className="entry-table w-full text-sm"
              columns={columnOrder
                .filter((id) => visibleColumns.has(id))
                .map((id) => ({
                  id,
                  label: JOURNAL_TRADE_COLUMNS.find(([key]) => key === id)?.[1] ?? id,
                }))}
            >
              <thead className="border-b">
                <tr>
                  {columnOrder
                    .filter((id) => visibleColumns.has(id))
                    .map((id) => (
                      <th
                        key={id}
                        className="whitespace-nowrap px-2 py-2 text-left font-medium text-muted-foreground"
                      >
                        {JOURNAL_TRADE_COLUMNS.find(([columnId]) => columnId === id)?.[1] ?? id}
                      </th>
                    ))}
                  <th className="w-8 px-1" aria-label="Snapshot" />
                  <th className="w-8 px-2" />
                </tr>
              </thead>
              <tbody>
                {tradesToRender.map((t, index) => (
                  <Fragment key={t.key}>
                    <AdaptiveEntryRow
                      afterExpanded={expandedTradeIndex >= 0 && index > expandedTradeIndex}
                      fields={columnOrder
                        .filter((id) => visibleColumns.has(id))
                        .map((id) => ({
                          id,
                          label: JOURNAL_TRADE_COLUMNS.find(([key]) => key === id)?.[1] ?? id,
                          value: cell(id, t),
                        }))}
                      expanded={expandedTradeKey === t.key}
                      onToggle={() =>
                        setExpandedTradeKey((current) => (current === t.key ? null : t.key))
                      }
                      indicator={
                        t.hasSnapshot ? (
                          <FileImage className="size-4" aria-label="Snapshot saved" />
                        ) : null
                      }
                    />
                    <tr
                      className={`desktop-entry-row cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50 ${expandedTradeIndex >= 0 && index > expandedTradeIndex ? "entry-after-expanded" : ""}`}
                      onClick={() =>
                        setExpandedTradeKey((current) => (current === t.key ? null : t.key))
                      }
                      aria-expanded={expandedTradeKey === t.key}
                    >
                      {columnOrder
                        .filter((id) => visibleColumns.has(id))
                        .map((id) => (
                          <td key={id} className="whitespace-nowrap px-2 py-3 align-middle tnum">
                            {cell(id, t)}
                          </td>
                        ))}
                      <td className="w-8 px-1 py-3 text-center">
                        {t.hasSnapshot ? (
                          <FileImage
                            className="mx-auto size-4 text-muted-foreground"
                            aria-label="Snapshot saved"
                          />
                        ) : null}
                      </td>
                      <td className="w-8 px-2 py-3 text-right text-muted-foreground">
                        {expandedTradeKey === t.key ? (
                          <ChevronUp className="inline size-4" />
                        ) : (
                          <ChevronDown className="inline size-4" />
                        )}
                      </td>
                    </tr>
                    {expandedTradeKey === t.key && (
                      <tr className="border-b bg-muted/10">
                        <td
                          colSpan={columnOrder.filter((id) => visibleColumns.has(id)).length + 2}
                          className="entry-detail p-3"
                        >
                          <ExpandedTrade
                            key={savedTrade?.key === t.key ? savedTrade.revision : 0}
                            tradeKey={t.key}
                            onEdit={() => onEditTrade(t.key)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </AdaptiveEntryTable>
          </div>
        )}
      </div>
    </div>
  );
}
