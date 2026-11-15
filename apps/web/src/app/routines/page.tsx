"use client";
import { DatePicker } from "@/components/ui/date-picker";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";

import { Suspense, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Pencil,
  Plus,
  Trash2,
  GripVertical,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Field, fieldClass } from "@/components/filter-fields";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApi, postJson } from "@/lib/use-api";
import { scheduledRules, progressScore, type Routine, type RoutineCheck } from "@/lib/progress";
import { RoutineDayCell } from "@/components/routine-day-cell";
const STAGES = ["Before trading", "During trading", "After trading"];
function SortableRoutine({
  routine,
  disabled,
  children,
}: {
  routine: Routine;
  disabled: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: routine.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-center gap-2 rounded-md ${isDragging ? "relative z-10 opacity-50" : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground opacity-50 hover:opacity-100"
        aria-label={`Drag ${routine.title}`}
        title="Drag to reorder"
      >
        <GripVertical className="size-4" />
      </button>
      {children}
    </div>
  );
}
export default function ProgressPage() {
  return (
    <Suspense>
      <Progress />
    </Suspense>
  );
}
function Progress() {
  const { data, error, refresh } = useApi<{
    rules: Routine[];
    checks: RoutineCheck[];
    today: string;
  }>("/api/workspace/progress");
  const [date, setDate] = useState(""),
    [open, setOpen] = useState(false),
    [editingId, setEditingId] = useState<string | null>(null),
    [editingTitle, setEditingTitle] = useState(""),
    [title, setTitle] = useState(""),
    [stage, setStage] = useState(STAGES[0]!),
    [weekdays, setWeekdays] = useState([1, 2, 3, 4, 5]),
    [failure, setFailure] = useState(""),
    [busy, setBusy] = useState(false),
    [deleteRoutine, setDeleteRoutine] = useState<Routine | null>(null);
  const selected = date || data?.today || "",
    rules = data ? scheduledRules(data.rules, selected) : [],
    score = data ? progressScore(data.rules, data.checks, selected) : null;
  const days = data
    ? Array.from({ length: 91 }, (_, i) => {
        const d = new Date(`${data.today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 90 + i);
        const key = d.toISOString().slice(0, 10);
        return { date: key, ...progressScore(data.rules, data.checks, key) };
      })
    : [];
  async function act(body: unknown, method: "POST" | "PATCH" | "DELETE" = "POST") {
    setBusy(true);
    try {
      await postJson("/api/workspace/progress", body, method);
      setFailure("");
      refresh();
      return true;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || over.id === active.id || busy) return;
    const source = data?.rules.find((item) => item.id === active.id);
    const stageRules = (data?.rules ?? [])
      .filter((item) => item.stage === source?.stage && !item.archivedAt)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
    const from = stageRules.findIndex((item) => item.id === active.id);
    const to = stageRules.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    const [moved] = stageRules.splice(from, 1);
    stageRules.splice(to, 0, moved!);
    void act({ reorder: stageRules.map((item, index) => ({ id: item.id, sortOrder: index })) });
  };
  return (
    <div>
      <FilterBar
        title="Routines"
        showSync

        actions={
          <Button
            size="sm"
            className="bg-black text-white hover:bg-black/90 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-black"
            onClick={() => setOpen(true)}
          >
            <Plus />
            Add routine
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        {(error || failure) && (
          <p role="alert" className="text-sm text-destructive">
            {error || failure}
          </p>
        )}
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-6 py-6">
            <div className="grid w-full max-w-3xl grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <p className="text-xs text-muted-foreground">Daily completion</p>
              <label className="text-xs text-muted-foreground" htmlFor="routine-review-date">
                Review date
              </label>
              <div>
                <p className="text-4xl font-semibold">
                  {score?.score == null ? "-" : `${Math.round(score.score * 100)}%`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {score?.completed ?? 0} of {score?.total ?? 0} scheduled routines
                </p>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl shadow-sm"
                  aria-label="Previous review date"
                  title="Previous day"
                  disabled={!selected}
                  onClick={() => {
                    const d = new Date(`${selected}T12:00:00Z`);
                    d.setUTCDate(d.getUTCDate() - 1);
                    setDate(d.toISOString().slice(0, 10));
                  }}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="min-w-0 w-1/2 flex-none">
                  <DatePicker
                    label="Routine date"
                    value={selected}
                    max={data?.today}
                    onValueChange={setDate}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl shadow-sm"
                  aria-label="Next review date"
                  title="Next day"
                  disabled={!selected || selected >= (data?.today ?? selected)}
                  onClick={() => {
                    const d = new Date(`${selected}T12:00:00Z`);
                    d.setUTCDate(d.getUTCDate() + 1);
                    setDate(d.toISOString().slice(0, 10));
                  }}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
          <div className="grid gap-4 xl:grid-cols-3">
            {STAGES.map((s) => (
              <Card key={s}>
                <CardHeader>
                  <CardTitle>{s}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SortableContext
                    items={rules
                      .filter((r) => r.stage === s)
                      .sort(
                        (a, b) =>
                          a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
                      )
                      .map((r) => r.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {rules
                      .filter((r) => r.stage === s)
                      .sort(
                        (a, b) =>
                          a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
                      )
                      .map((r) => (
                        <SortableRoutine key={r.id} routine={r} disabled={busy}>
                          <label className="min-w-0 flex-1 flex items-center gap-3 text-sm">
                            <Checkbox
                              checked={
                                data?.checks.some(
                                  (c) => c.ruleId === r.id && c.date === selected && c.done,
                                ) ?? false
                              }
                              disabled={busy || selected > (data?.today ?? "")}
                              onCheckedChange={(checked) =>
                                void act({ ruleId: r.id, date: selected, done: checked === true })
                              }
                            />
                            {editingId === r.id ? (
                              <input
                                autoFocus
                                className={fieldClass + " h-8 min-w-0 flex-1 px-2"}
                                value={editingTitle}
                                maxLength={200}
                                onChange={(event) => setEditingTitle(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={async (event) => {
                                  if (event.key === "Escape") {
                                    setEditingId(null);
                                    return;
                                  }
                                  if (event.key !== "Enter") return;
                                  event.preventDefault();
                                  const title = editingTitle.trim();
                                  if (!title || title === r.title) {
                                    setEditingId(null);
                                    return;
                                  }
                                  if (await act({ id: r.id, title }, "PATCH")) setEditingId(null);
                                }}
                              />
                            ) : (
                              <span>{r.title}</span>
                            )}
                          </label>
                          <div
                            className={`flex shrink-0 items-center gap-1 transition-opacity ${editingId === r.id ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
                          >
                            {editingId === r.id ? (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                  title="Save name"
                                  aria-label="Save routine name"
                                  onClick={async () => {
                                    const title = editingTitle.trim();
                                    if (!title || title === r.title) {
                                      setEditingId(null);
                                      setEditingTitle(r.title);
                                      return;
                                    }
                                    if (await act({ id: r.id, title }, "PATCH")) setEditingId(null);
                                  }}
                                >
                                  <Check className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                  title="Cancel editing"
                                  aria-label="Cancel routine title edit"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditingTitle(r.title);
                                  }}
                                >
                                  <X className="size-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                                  title="Edit routine"
                                  aria-label="Edit routine"
                                  onClick={() => {
                                    setEditingId(r.id);
                                    setEditingTitle(r.title);
                                  }}
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                                  title="Delete routine"
                                  aria-label="Delete routine"
                                  onClick={() => setDeleteRoutine(r)}
                                >
                                  <Trash2 className="size-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </SortableRoutine>
                      ))}
                  </SortableContext>
                  {!rules.some((r) => r.stage === s) && (
                    <p className="text-xs text-muted-foreground">No routines scheduled.</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </DndContext>
        <Card>
          <CardHeader>
            <CardTitle>Last 13 weeks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto">
              {days.map((d) => (
                <RoutineDayCell
                  key={d.date}
                  date={d.date}
                  completed={d.completed}
                  total={d.total}
                  score={d.score}
                  selected={selected === d.date}
                  onClick={() => setDate(d.date)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
        <Dialog
          open={deleteRoutine !== null}
          onOpenChange={(next) => !next && setDeleteRoutine(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete routine?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete “{deleteRoutine?.title}”? This removes the routine and
              its completion history.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteRoutine(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={!deleteRoutine || busy}
                onClick={async () => {
                  if (deleteRoutine && (await act({ id: deleteRoutine.id }, "DELETE"))) {
                    setDeleteRoutine(null);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a daily routine</DialogTitle>
            </DialogHeader>
            <Field label="Routine">
              <input
                className={fieldClass}
                value={title}
                placeholder="Review the economic calendar"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="When">
              <OptionSelect
                className={fieldClass}
                value={stage}
                onValueChange={(next) => setStage(next)}
              >
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </OptionSelect>
            </Field>
            <div className="flex flex-wrap gap-3">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
                <label key={day} className="flex items-center gap-1 text-xs">
                  <Checkbox
                    checked={weekdays.includes(i)}
                    onCheckedChange={(checked) =>
                      setWeekdays(
                        checked === true ? [...weekdays, i] : weekdays.filter((n) => n !== i),
                      )
                    }
                  />
                  {day}
                </label>
              ))}
            </div>
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button
              disabled={!title.trim() || !weekdays.length || busy}
              onClick={async () => {
                if (await act({ title, stage, weekdays })) {
                  setOpen(false);
                  setTitle("");
                }
              }}
            >
              Add routine
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
