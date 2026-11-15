"use client";

import { Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { AdherenceReport } from "@/components/adherence-report";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { postJson, useApi } from "@/lib/use-api";
import { saveUiPreference, useUiPreferences } from "@/lib/ui-preferences-client";

interface Playbook {
  id: string;
  name: string;
  description: string;
  rules: string[];
  tradeCount: number;
}

const PLAYBOOK_ORDER_KEY = "journal-playbook-order-v1";

export default function PlaybooksPage() {
  return (
    <Suspense>
      <Playbooks />
    </Suspense>
  );
}

function PlaybookGrid({
  playbooks,
  onEdit,
  onDelete,
}: {
  playbooks: Playbook[];
  onEdit: (playbook: Playbook) => void;
  onDelete: (playbook: Playbook) => void;
}) {
  const { data: uiSettings } = useUiPreferences();
  const [ordered, setOrdered] = useState<Playbook[]>(playbooks);
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [columnCount, setColumnCount] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!uiSettings) return;
    const saved = uiSettings.preferences.playbookOrder;
    let savedIds: string[] = [];
    if (saved !== undefined) {
      savedIds = parseOrder(JSON.stringify(saved));
      try {
        localStorage.removeItem(PLAYBOOK_ORDER_KEY);
      } catch {
        // Ignore restricted browser storage.
      }
    } else {
      try {
        const stored = localStorage.getItem(PLAYBOOK_ORDER_KEY);
        savedIds = stored ? parseOrder(stored) : [];
        if (stored !== null) {
          void saveUiPreference("playbookOrder", savedIds)
            .then(() => {
              try {
                localStorage.removeItem(PLAYBOOK_ORDER_KEY);
              } catch {
                // Ignore restricted browser storage.
              }
            })
            .catch(() => {
              // Keep the legacy browser copy if the one-time migration fails.
            });
        }
      } catch {
        savedIds = [];
      }
    }
    const byId = new Map(playbooks.map((playbook) => [playbook.id, playbook]));
    const next = [
      ...savedIds
        .map((id) => byId.get(id))
        .filter((playbook): playbook is Playbook => Boolean(playbook)),
      ...playbooks.filter((playbook) => !savedIds.includes(playbook.id)),
    ];
    setOrdered(next);
  }, [playbooks, uiSettings]);

  useEffect(() => {
    const updateColumns = () => {
      setColumnCount(
        window.matchMedia("(min-width: 1280px)").matches
          ? 3
          : window.matchMedia("(min-width: 768px)").matches
            ? 2
            : 1,
      );
    };
    updateColumns();
    window.addEventListener("resize", updateColumns);
    return () => window.removeEventListener("resize", updateColumns);
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const measure = () => {
      const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-playbook-card]"));
      if (cards.length === 0) {
        setCardHeight(null);
        return;
      }

      // Measure natural collapsed content, not the fixed height previously assigned to
      // the sortable wrapper. Otherwise a ResizeObserver pass can measure its own output
      // and preserve an incorrect height indefinitely.
      const expandedDetails = cards.flatMap((card) =>
        Array.from(card.querySelectorAll<HTMLDetailsElement>("details[open]")),
      );
      const savedStyles = cards.map((card) => {
        const inner = card.querySelector<HTMLElement>("[data-playbook-inner-card]");
        return {
          card,
          inner,
          cardHeight: card.style.height,
          innerPosition: inner?.style.position ?? "",
          innerTop: inner?.style.top ?? "",
          innerRight: inner?.style.right ?? "",
          innerBottom: inner?.style.bottom ?? "",
          innerLeft: inner?.style.left ?? "",
          innerMinHeight: inner?.style.minHeight ?? "",
        };
      });

      expandedDetails.forEach((details) => {
        details.open = false;
      });
      savedStyles.forEach(({ card, inner }) => {
        card.style.height = "auto";
        if (inner) {
          inner.style.position = "static";
          inner.style.top = "auto";
          inner.style.right = "auto";
          inner.style.bottom = "auto";
          inner.style.left = "auto";
          inner.style.minHeight = "0px";
        }
      });
      const tallest = Math.ceil(
        Math.max(
          ...savedStyles.map(
            ({ card, inner }) =>
              inner?.getBoundingClientRect().height ?? card.getBoundingClientRect().height,
          ),
        ),
      );
      savedStyles.forEach(
        ({
          card,
          inner,
          cardHeight,
          innerPosition,
          innerTop,
          innerRight,
          innerBottom,
          innerLeft,
          innerMinHeight,
        }) => {
          card.style.height = cardHeight;
          if (inner) {
            inner.style.position = innerPosition;
            inner.style.top = innerTop;
            inner.style.right = innerRight;
            inner.style.bottom = innerBottom;
            inner.style.left = innerLeft;
            inner.style.minHeight = innerMinHeight;
          }
        },
      );
      expandedDetails.forEach((details) => {
        details.open = true;
      });
      setCardHeight((current) => (current === tallest ? current : tallest));
    };

    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(() => {
      // Expanded details are allowed to change only their own column's flow. Do not
      // reinterpret that expanded height as the shared collapsed-card baseline.
      if (grid.querySelector("details[open]")) return;
      measure();
    });
    observer.observe(grid);
    // Observe both the sortable slot and the actual card content. The slot has a
    // fixed baseline height while collapsed, so observing only the slot misses
    // asynchronous content changes (for example when AdherenceReport finishes
    // loading after navigating away from and back to Strategies).
    grid.querySelectorAll<HTMLElement>("[data-playbook-card]").forEach((card) => {
      observer.observe(card);
      const inner = card.querySelector<HTMLElement>("[data-playbook-inner-card]");
      if (inner) observer.observe(inner);
    });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ordered, columnCount]);

  const columns = Array.from({ length: columnCount }, (_, column) =>
    ordered.filter((_, index) => index % columnCount === column),
  );
  const visualOrder = columns.flat();

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = visualOrder.findIndex((playbook) => playbook.id === String(active.id));
    const to = visualOrder.findIndex((playbook) => playbook.id === String(over.id));
    if (from < 0 || to < 0 || from === to) return;
    const reorderedVisual = [...visualOrder];
    const [moved] = reorderedVisual.splice(from, 1);
    reorderedVisual.splice(to, 0, moved!);
    const columnLengths = columns.map((column) => column.length);
    const nextColumns: Playbook[][] = [];
    let offset = 0;
    for (const length of columnLengths) {
      nextColumns.push(reorderedVisual.slice(offset, offset + length));
      offset += length;
    }
    const next: Playbook[] = [];
    for (let row = 0; row < Math.max(...nextColumns.map((column) => column.length), 0); row++) {
      for (const column of nextColumns) {
        if (column[row]) next.push(column[row]!);
      }
    }
    setOrdered(next);
    void saveUiPreference(
      "playbookOrder",
      next.map((playbook) => playbook.id),
    );
    try {
      localStorage.removeItem(PLAYBOOK_ORDER_KEY);
    } catch {
      // Ignore restricted browser storage.
    }
  };

  if (playbooks.length === 0) {
    return (
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        <p className="col-span-full py-16 text-center text-sm text-muted-foreground">
          A strategy is a setup you trade on purpose — name it, write its rules, then tag trades
          with it and let Reports tell you if it actually pays.
        </p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={visualOrder.map((playbook) => playbook.id)}
        strategy={rectSortingStrategy}
      >
        <div ref={gridRef} className="grid items-start gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
          {columns.map((column, columnIndex) => (
            <div
              key={`strategy-column-${columnIndex}`}
              className="flex min-w-0 flex-col items-stretch gap-3"
            >
              {column.map((playbook) => (
                <SortablePlaybookCard
                  key={playbook.id}
                  playbook={playbook}
                  cardHeight={cardHeight}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function parseOrder(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function StrategyRules({ rules, name }: { rules: string[]; name: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [visibleHeight, setVisibleHeight] = useState<number>();
  const scrollable = rules.length > 5;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !scrollable) return;

    const measure = () => {
      const first = list.children[0];
      const fifth = list.children[4];
      if (first && fifth) {
        setVisibleHeight(fifth.getBoundingClientRect().bottom - first.getBoundingClientRect().top);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    Array.from(list.children)
      .slice(0, 5)
      .forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [rules, scrollable]);

  return (
    <ul
      ref={listRef}
      className={`space-y-1 text-sm${scrollable ? " overflow-y-auto overscroll-y-contain rounded-sm pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" : ""}`}
      style={scrollable ? { maxHeight: visibleHeight, scrollbarGutter: "stable" } : undefined}
      tabIndex={scrollable ? 0 : undefined}
      aria-label={`Rules for ${name}`}
    >
      {rules.map((rule, index) => (
        <li key={index} className="flex min-w-0 gap-2 break-words">
          <span className="shrink-0 text-muted-foreground">{index + 1}.</span>
          <span className="min-w-0">{rule}</span>
        </li>
      ))}
    </ul>
  );
}

function SortablePlaybookCard({
  playbook,
  cardHeight,
  onEdit,
  onDelete,
}: {
  playbook: Playbook;
  cardHeight: number | null;
  onEdit: (playbook: Playbook) => void;
  onDelete: (playbook: Playbook) => void;
}) {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const updateExpandedState = () => {
      setDetailsExpanded(Boolean(card.querySelector("details[open]")));
    };
    const observer = new MutationObserver(updateExpandedState);
    observer.observe(card, {
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    updateExpandedState();
    return () => observer.disconnect();
  }, []);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: playbook.id });

  return (
    <div
      ref={(node) => {
        cardRef.current = node;
        setNodeRef(node);
      }}
      data-playbook-card
      style={{
        height: cardHeight && !detailsExpanded ? `${cardHeight}px` : undefined,
        position: "relative",
        zIndex: isDragging ? 30 : undefined,
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})`
          : undefined,
        transition,
      }}
      className={isDragging ? "opacity-75" : ""}
    >
      <Card
        data-playbook-inner-card
        className="w-full"
        style={{ minHeight: cardHeight ? `${cardHeight}px` : undefined }}
      >
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="text-foreground min-w-0 text-base font-semibold">
              {playbook.name}
            </CardTitle>
            <Button
              ref={setActivatorNodeRef}
              type="button"
              variant="ghost"
              size="icon"
              {...attributes}
              {...listeners}
              className="h-7 w-7 shrink-0 touch-none cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
              aria-label={`Rearrange ${playbook.name}`}
              title={`Drag to rearrange ${playbook.name}`}
            >
              <GripVertical />
            </Button>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="text-xs text-muted-foreground">{playbook.tradeCount} trades</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => onEdit(playbook)}
              aria-label={`Edit ${playbook.name}`}
              title="Edit strategy"
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(playbook)}
            >
              <Trash2 />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {playbook.description && (
            <p className="text-sm text-muted-foreground">{playbook.description}</p>
          )}
          {playbook.rules.length > 0 && (
            <StrategyRules rules={playbook.rules} name={playbook.name} />
          )}
          <AdherenceReport bookId={playbook.id} />
        </CardContent>
      </Card>
    </div>
  );
}

function Playbooks() {
  const { data, refresh } = useApi<{ playbooks: Playbook[] }>("/api/playbooks");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Playbook | null>(null);

  const resetForm = () => {
    setOpen(false);
    setEditing(null);
    setName("");
    setDescription("");
    setRules("");
  };

  const create = async () => {
    await postJson("/api/playbooks", {
      name,
      description,
      rules: rules
        .split("\n")
        .map((rule) => rule.trim())
        .filter(Boolean),
    });
    resetForm();
    refresh();
  };

  const edit = (playbook: Playbook) => {
    setEditing(playbook);
    setName(playbook.name);
    setDescription(playbook.description);
    setRules(playbook.rules.join("\n"));
    setOpen(true);
  };

  const save = async () => {
    if (!editing) return;
    await postJson(
      `/api/playbooks/${editing.id}`,
      {
        name,
        description,
        rules: rules
          .split("\n")
          .map((rule) => rule.trim())
          .filter(Boolean),
      },
      "PATCH",
    );
    resetForm();
    refresh();
  };

  return (
    <div>
      <FilterBar
        title="Strategies"
        showSync

        showFilters={false}
        actions={
          <Button
            size="sm"
            className="bg-black text-white hover:bg-black/90 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-black"
            onClick={() => {
              setEditing(null);
              setName("");
              setDescription("");
              setRules("");
              setOpen(true);
            }}
          >
            <Plus />
            Add strategy
          </Button>
        }
      />
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete strategy?</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Trades keep their data, just lose the strategy link.
            </p>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return;
                await postJson(`/api/playbooks/${deleteTarget.id}`, undefined, "DELETE");
                setDeleteTarget(null);
                refresh();
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <PlaybookGrid playbooks={data?.playbooks ?? []} onEdit={edit} onDelete={setDeleteTarget} />

      <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : resetForm())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit strategy" : "New strategy"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name (e.g. Opening range breakout)"
            />
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="One-line description"
            />
            <Textarea
              value={rules}
              onChange={(event) => setRules(event.target.value)}
              placeholder={
                "One rule per line:\nOnly A+ setups\nRisk max 1R\nNo entries after 11:30"
              }
              className="min-h-32"
            />
            <Button onClick={editing ? save : create} disabled={!name}>
              {editing ? "Save changes" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
