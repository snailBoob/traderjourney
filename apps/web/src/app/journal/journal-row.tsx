"use client";

import { Pnl } from "@/components/pnl";
import { AdaptiveEntryRow } from "@/components/adaptive-entry-row";
import { RoutineDayCell } from "@/components/routine-day-cell";
import { Badge } from "@/components/ui/badge";
import { useApi } from "@/lib/use-api";
import { fmtPercent } from "@/lib/utils";
import { ChevronDown, ChevronUp, NotebookPen } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { ExpandedDay } from "./expanded-day";
import type { DayPayload, JournalDay } from "./types";

const formatSessionDuration = (minutes: number | null) => {
  if (minutes == null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
};

export function JournalRow({
  day,
  expanded,
  anyExpanded,
  columns,
  columnOrder,
  onToggle,
  onEdit,
  onRefresh,
  onDelete,
  onLightbox,
  strategyNames,
  detailRefreshToken,
  onEditTrade,
  savedTrade,
  columnLabels,
  sortColumn,
  afterExpanded,
}: {
  day: JournalDay;
  expanded: boolean;
  anyExpanded: boolean;
  columns: Set<string>;
  columnOrder: string[];
  onToggle: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onLightbox: (id: string) => void;
  strategyNames: { id: string; name: string }[];
  detailRefreshToken: number;
  onEditTrade: (tradeKey: string) => void;
  savedTrade: { key: string; revision: number } | null;
  columnLabels: Record<string, string>;
  sortColumn: (id: string) => (() => void) | undefined;
  afterExpanded: boolean;
}) {
  const { data, refresh: refreshDetail } = useApi<DayPayload>(
    expanded ? `/api/journal/${day.date}` : null,
  );
  useEffect(() => {
    if (expanded && detailRefreshToken > 0) refreshDetail();
  }, [detailRefreshToken, expanded, refreshDetail]);
  const show = (id: string) => columns.has(id);
  const cells: Record<string, ReactNode> = {
    date: day.date,
    pnl: day.stats ? (
      <Pnl value={day.stats.netPnl} className="font-semibold" />
    ) : (
      <span className="text-muted-foreground">—</span>
    ),
    trades: day.stats ? day.stats.trades : "—",
    winrate: day.stats
      ? fmtPercent(day.stats.trades ? day.stats.wins / day.stats.trades : null, 0)
      : "—",
    wl: day.stats ? `${day.stats.wins} / ${day.stats.losses}` : "—",
    bias: day.dailyBias.length ? (
      <div className="flex flex-wrap gap-1">
        {day.dailyBias.map((id) => (
          <Badge
            key={id}
            variant="secondary"
            className="rounded-full border border-border/60 bg-muted px-2.5 py-0.5 text-foreground"
          >
            {strategyNames.find((s) => s.id === id)?.name ?? id}
          </Badge>
        ))}
      </div>
    ) : (
      "—"
    ),
    sessionDuration: formatSessionDuration(day.sessionDurationMinutes),
    routine: (
      <div className="inline-flex items-center gap-2">
        <RoutineDayCell
          date={day.date}
          completed={day.routine.completed}
          total={day.routine.total}
          score={day.routine.score}
          selected={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        />
        <span className="tnum text-xs text-muted-foreground">
          {day.routine.score == null ? "—" : fmtPercent(day.routine.score, 0)}
        </span>
      </div>
    ),
  };
  return (
    <>
      <AdaptiveEntryRow
        afterExpanded={afterExpanded}
        id={`journal-day-mobile-${day.date}`}
        fields={columnOrder.filter(show).map((id) => ({
          id,
          label: columnLabels[id] ?? id,
          value: cells[id],
          onSort: sortColumn(id),
        }))}
        expanded={expanded}
        onToggle={onToggle}
        indicator={day.hasNote ? <NotebookPen className="size-4" aria-label="Note exists" /> : null}
      />
      <tr
        id={`journal-day-${day.date}`}
        className={`desktop-entry-row cursor-pointer align-middle border-b hover:bg-accent/40 ${afterExpanded ? "entry-after-expanded" : ""}`}
        onClick={onToggle}
      >
        {columnOrder.map((id) =>
          show(id) ? (
            <td
              key={id}
              className={`px-3 py-3 ${id === "date" ? "font-medium" : "text-muted-foreground"}`}
            >
              {cells[id]}
            </td>
          ) : null,
        )}
        <td className="w-12 px-2 py-3 text-center">
          {day.hasNote ? (
            <NotebookPen
              className="mx-auto size-4 text-muted-foreground"
              aria-label="Note exists"
            />
          ) : null}
        </td>
        <td className="w-12 px-2 py-3 text-right">
          <div className="flex items-center justify-end">
            <span className="flex h-7 w-7 items-center justify-center">
              {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </span>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td
            colSpan={columnOrder.filter((id) => show(id)).length + 2}
            className="entry-detail border-b bg-background px-4 py-4"
          >
            <ExpandedDay
              data={data}
              loading={!data}
              onEdit={onEdit}
              onEditTrade={onEditTrade}
              savedTrade={savedTrade}
              onRefresh={() => {
                onRefresh();
                refreshDetail();
              }}
              onDelete={onDelete}
              onLightbox={onLightbox}
            />
          </td>
        </tr>
      )}
    </>
  );
}
