"use client";

import { Badge } from "@/components/ui/badge";
import { AdaptiveEntryRow } from "@/components/adaptive-entry-row";
import { AdaptiveEntryTable } from "@/components/adaptive-entry-table";
import { ColumnPanel } from "@/components/column-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowUpDown, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ExpandedMissedTrade } from "./expanded-missed-trade";
import { formatDate, outcomeLabel, rulesFollowedPercent } from "./format";
import { type Missed, type Outcome, type Playbook } from "./types";
const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});
function SortableMissedColumn({
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
export function MissedTradesTable({
  data,
  books,
  filterQuery,
  expanded,
  setExpanded,
  showColumns,
  setShowColumns,
  columnTriggerRef,
  edit,
  setDeleteTarget,
  setFullscreenId,
  children,
}: {
  data: { trades: Missed[] } | null;
  books: { playbooks: Playbook[] } | null;
  filterQuery: string;
  expanded: string | null;
  setExpanded: (id: string | null) => void;
  showColumns: boolean;
  setShowColumns: (value: boolean) => void;
  columnTriggerRef: RefObject<HTMLDivElement | null>;
  edit: (trade?: Missed, focus?: "note" | "snapshot" | null) => void;
  setDeleteTarget: (trade: Missed) => void;
  setFullscreenId: (id: string | null) => void;
  children: ReactNode;
}) {
  const columnPanelRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const { data: uiPreferences } = useUiPreferences();
  const [columnOrder, setColumnOrder] = useState<string[]>([
    "observedAt",
    "symbol",
    "strategy",
    "outcome",
    "rulesFollowed",
    "tags",
  ]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  useEffect(() => setPage(0), [filterQuery]);
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
  useEffect(() => {
    const saved = uiPreferences?.preferences.missedTradesColumnOrder;
    if (Array.isArray(saved)) {
      const ids = ["observedAt", "symbol", "strategy", "outcome", "rulesFollowed", "tags"];
      const valid = saved.filter((id): id is string => typeof id === "string" && ids.includes(id));
      setColumnOrder([...valid, ...ids.filter((id) => !valid.includes(id))]);
    }
  }, [uiPreferences?.preferences.missedTradesColumnOrder]);
  const playbookName = (id: string | null) =>
    books?.playbooks.find((book) => book.id === id)?.name ?? "—";
  const rangeFilteredRows = data?.trades ?? [];
  const columns = useMemo<ColumnDef<typeof features, Missed>[]>(
    () => [
      {
        id: "observedAt",
        accessorKey: "observedAt",
        header: "Date",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{formatDate(getValue<string>())}</span>
        ),
      },
      {
        id: "symbol",
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ getValue }) => <span className="font-medium">{getValue<string>()}</span>,
      },
      {
        id: "strategy",
        accessorFn: (row) => playbookName(row.playbookId),
        header: "Strategy",
        cell: ({ row }) => <span>{playbookName(row.original.playbookId)}</span>,
      },
      {
        id: "outcome",
        accessorKey: "outcome",
        header: "Outcome",
        cell: ({ getValue }) => <span>{outcomeLabel(getValue<Outcome | null>())}</span>,
      },
      {
        id: "rulesFollowed",
        accessorFn: (row) => rulesFollowedPercent(row) ?? -1,
        enableSorting: true,
        header: "Rules followed",
        cell: ({ row }) => {
          const percent = rulesFollowedPercent(row.original);
          return <span className="tnum">{percent === null ? "—" : `${percent}%`}</span>;
        },
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
    ],
    [books?.playbooks],
  );

  const orderedColumns = useMemo(
    () =>
      columnOrder
        .map((id) => columns.find((column) => column.id === id))
        .filter((column): column is ColumnDef<typeof features, Missed> => Boolean(column)),
    [columnOrder, columns],
  );
  const table = useTable({
    features,
    columns: orderedColumns,
    data: rangeFilteredRows,
    getRowId: (row) => row.id,
    initialState: {
      sorting: [{ id: "observedAt", desc: true }],
    },
  });
  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumnOrder((current) => {
      const oldIndex = current.indexOf(String(active.id));
      const newIndex = current.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return current;
      const next = arrayMove(current, oldIndex, newIndex);
      void saveUiPreference("missedTradesColumnOrder", next);
      return next;
    });
  };

  const sortedRows = table.getRowModel().rows;
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const expandedIndex = expanded
    ? visibleRows.findIndex((row) => row.original.id === expanded)
    : -1;
  const rowsToRender = visibleRows;
  const visibleColumns = table.getVisibleLeafColumns();
  return (
    <>
      {" "}
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
                      const tableColumn = table.getAllLeafColumns().find((item) => item.id === id);
                      return (
                        <SortableMissedColumn
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
      {children}{" "}
      <Card>
        <div className="relative min-w-0 max-w-full overflow-x-auto">
          <AdaptiveEntryTable
            className="entry-table w-full min-w-[860px] table-fixed text-sm"
            columns={visibleColumns.map((column) => ({
              id: column.id,
              label:
                typeof column.columnDef.header === "string" ? column.columnDef.header : column.id,
              onSort: column.getCanSort()
                ? () => {
                    setPage(0);
                    column.toggleSorting();
                  }
                : undefined,
            }))}
          >
            <colgroup>
              {visibleColumns.map((column) => (
                <col
                  key={column.id}
                  style={{ width: `calc((100% - 40px) / ${Math.max(visibleColumns.length, 1)})` }}
                />
              ))}
              <col style={{ width: "40px" }} />
            </colgroup>
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
                          {typeof header.column.columnDef.header === "string"
                            ? header.column.columnDef.header
                            : null}
                          <ArrowUpDown
                            className={`h-3 w-3 ${header.column.getIsSorted() ? "text-foreground" : ""}`}
                          />
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </th>
                  ))}
                  <th className="h-9 px-2" />
                </tr>
              ))}
            </thead>
            <tbody>
              {rowsToRender.map((row, index) => {
                const trade = row.original;
                const isExpanded = expanded === trade.id;
                return (
                  <Fragment key={row.id}>
                    <AdaptiveEntryRow
                      afterExpanded={expandedIndex >= 0 && index > expandedIndex}
                      fields={row.getVisibleCells().map((cell) => ({
                        id: cell.column.id,
                        label:
                          typeof cell.column.columnDef.header === "string"
                            ? cell.column.columnDef.header
                            : cell.column.id,
                        value: <table.FlexRender cell={cell} />,
                        onSort: cell.column.getCanSort()
                          ? () => {
                              setPage(0);
                              cell.column.toggleSorting();
                            }
                          : undefined,
                      }))}
                      expanded={isExpanded}
                      onToggle={() => setExpanded(isExpanded ? null : trade.id)}
                    />
                    <tr
                      className={`desktop-entry-row cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/50 ${expandedIndex >= 0 && index > expandedIndex ? "entry-after-expanded" : ""}`}
                      onClick={() => setExpanded(isExpanded ? null : trade.id)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id} className="whitespace-nowrap px-2 py-3 align-middle">
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                      <td className="px-2 py-3 text-right align-middle">
                        {isExpanded ? (
                          <ChevronUp className="ml-auto h-4 w-4" />
                        ) : (
                          <ChevronDown className="ml-auto h-4 w-4" />
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b last:border-0">
                        <td
                          colSpan={visibleColumns.length + 1}
                          className="entry-detail bg-background px-4 py-4"
                        >
                          <ExpandedMissedTrade
                            trade={trade}
                            strategyName={playbookName(trade.playbookId)}
                            edit={edit}
                            setDeleteTarget={setDeleteTarget}
                            setFullscreenId={setFullscreenId}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {data && !visibleRows.length && (
                <tr>
                  <td
                    colSpan={visibleColumns.length + 1}
                    className="py-16 text-center text-sm text-muted-foreground"
                  >
                    No missed trades match the current selection.
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
              {Math.min((currentPage + 1) * pageSize, sortedRows.length)} of {sortedRows.length}{" "}
              missed trades
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
    </>
  );
}
