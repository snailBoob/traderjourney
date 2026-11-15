"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  GripVertical,
  LayoutTemplate,
  ListOrdered,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  dashboardLayoutPresets,
  normalizeArrangement,
  visibleCardIds,
  type DashboardArrangement,
} from "@/lib/dashboard-layout";

function LayoutRow({
  name,
  description,
  layout,
  active,
  index,
  custom,
  editing,
  renameName,
  onLoad,
  onRename,
  onRenameNameChange,
  onRenameCancel,
  onRenameSubmit,
  onReplace,
  onDelete,
  reorderMode,
}: {
  name: string;
  description?: string;
  layout: DashboardArrangement;
  active: boolean;
  index: number;
  custom: boolean;
  editing: boolean;
  renameName: string;
  onLoad(): void;
  onRename?(): void;
  onRenameNameChange?(value: string): void;
  onRenameCancel?(): void;
  onRenameSubmit?(): void;
  onReplace?(): void;
  onDelete?(): void;
  reorderMode: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: name,
  });
  return (
    <div
      ref={setNodeRef}
      className={`dashboard-customize-option dashboard-layout-option flex items-center gap-1 ${isDragging ? "relative z-10 opacity-70 shadow-md" : ""}`}
      style={
        {
          "--option-index": Math.min(index, 7),
          transform: CSS.Transform.toString(transform),
          transition,
        } as CSSProperties
      }
      data-saved-layout-row
    >
      <div className="dashboard-layout-selection-indicator">
        {reorderMode ? (
          <button
            type="button"
            className="touch-none flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
            aria-label={`Reorder ${name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={15} aria-hidden="true" />
          </button>
        ) : active ? (
          <Check size={16} className="text-foreground" />
        ) : null}
      </div>
      <button
        type="button"
        className={`dashboard-customize-card-icon dashboard-layout-select-icon ${custom ? "dashboard-layout-custom-icon" : "dashboard-layout-preset-icon"}`}
        aria-label={`Load ${name}`}
        aria-pressed={active}
        onClick={onLoad}
      >
        <LayoutTemplate size={15} aria-hidden="true" />
      </button>
      <div className="dashboard-layout-title-zone min-w-0 flex-1">
        {editing && custom ? (
          <Input
            autoFocus
            value={renameName}
            maxLength={80}
            aria-label={`Rename ${name}`}
            className="h-8 min-w-0 flex-1 rounded-md px-2 text-xs"
            onChange={(event) => onRenameNameChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRenameSubmit?.();
              }
              if (event.key === "Escape") onRenameCancel?.();
            }}
          />
        ) : (
          <button
            type="button"
            data-saved-layout
            className="min-w-0 w-full text-left"
            aria-label={`Load ${name}`}
            aria-pressed={active}
            onClick={onLoad}
          >
            <span className="block whitespace-nowrap text-xs font-medium">
              {name}
              <span className="ml-2 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                {visibleCardIds(layout).length} cards
              </span>
            </span>
            {description && (
              <span className="dashboard-layout-description mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                {description}
              </span>
            )}
          </button>
        )}
        {custom && (
          <div
            className={`dashboard-layout-actions flex shrink-0 items-center gap-0 ${editing ? "dashboard-layout-actions-editing" : ""}`}
          >
            {!editing && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                aria-label={`Rename ${name}`}
                title="Rename layout"
                onClick={onRename}
              >
                <Pencil size={14} />
              </Button>
            )}
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Save renamed layout ${name}`}
                  title="Save name"
                  disabled={!renameName.trim()}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onRenameSubmit}
                >
                  <Check size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Cancel renaming ${name}`}
                  title="Cancel"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onRenameCancel}
                >
                  <X size={14} />
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={`Replace layout ${name}`}
                  title="Replace layout"
                  onClick={onReplace}
                >
                  <Save size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 hover:text-destructive"
                  aria-label={`Delete ${name}`}
                  title="Delete layout"
                  onClick={onDelete}
                >
                  <Trash2 size={14} />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardSavedLayouts({
  layouts,
  layoutOrder,
  current,
  ids,
  onLoad,
  onSave,
  onRename,
  onReplace,
  onDelete,
  onReorder,
}: {
  layouts: Record<string, DashboardArrangement>;
  layoutOrder: string[];
  current: DashboardArrangement;
  ids: string[];
  onLoad(name: string, arrangement: DashboardArrangement): void;
  onSave(name: string): boolean;
  onRename(name: string, nextName: string): boolean;
  onReplace(name: string): boolean;
  onDelete(name: string): boolean;
  onReorder(order: string[]): boolean;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState("");
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [confirm, setConfirm] = useState<{ type: "replace" | "delete"; name: string } | null>(null);
  const [actionError, setActionError] = useState("");
  const [reorderMode, setReorderMode] = useState(false);
  const titleId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const presets = dashboardLayoutPresets(ids);
  const presetNames = new Set(presets.map((preset) => preset.name));
  const sequence = [
    ...layoutOrder.filter((entry) => presetNames.has(entry) || Boolean(layouts[entry])),
    ...presets
      .map((preset) => preset.name)
      .filter((presetName) => !layoutOrder.includes(presetName)),
    ...Object.keys(layouts).filter((layoutName) => !layoutOrder.includes(layoutName)),
  ];
  const selectedPreset = presets.find(
    (preset) => JSON.stringify(preset.arrangement) === JSON.stringify(current),
  );
  const selectedCustom = Object.entries(layouts).find(
    ([, layout]) => JSON.stringify(normalizeArrangement(layout, ids)) === JSON.stringify(current),
  );
  const selectedLayoutName = selectedPreset?.name ?? selectedCustom?.[0] ?? "Custom layout";
  const selectedCardCount = visibleCardIds(current).length;

  function handleReorder(event: DragEndEvent) {
    if (!event.over) return;
    const activeName = String(event.active.id);
    const overId = String(event.over.id);
    const overName = overId.startsWith("preset:") ? overId.slice("preset:".length) : overId;
    if (!sequence.includes(activeName) || !sequence.includes(overName)) return;
    const from = sequence.indexOf(activeName);
    const to = sequence.indexOf(overName);
    if (from < 0 || to < 0 || from === to) return;
    onReorder(arrayMove(sequence, from, to));
  }

  function submitRename() {
    if (!renameTarget || !renameName.trim()) return;
    if (onRename(renameTarget, renameName.trim())) {
      setRenameTarget(null);
      setRenameName("");
      setActionError("");
    } else setActionError("A layout with that name already exists.");
  }

  function confirmAction() {
    if (!confirm) return;
    const ok = confirm.type === "replace" ? onReplace(confirm.name) : onDelete(confirm.name);
    if (ok) {
      setConfirm(null);
      setActionError("");
    }
  }

  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setSaved("");
          setActionError("");
          setRenameTarget(null);
          setRenameName("");
        }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Popover.Trigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="dashboard-customize-trigger"
              aria-label="Dashboard layouts"
            >
              <LayoutTemplate /> Layouts <ChevronDown className="dashboard-customize-chevron" />
            </Button>
          </Popover.Trigger>
          <div
            className="dashboard-layout-current-selection min-w-0 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <span className="dashboard-layout-current-name font-semibold text-foreground">
              {selectedLayoutName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">
              {selectedCardCount} of {ids.length} cards
            </span>
          </div>
        </div>
        <Popover.Portal>
          <Popover.Content
            className="dashboard-customize-panel dashboard-layout-panel"
            align="start"
            sideOffset={10}
            collisionPadding={12}
            aria-labelledby={titleId}
          >
            <div className="dashboard-customize-heading">
              <h2 id={titleId}>Dashboard layouts</h2>
              <div className="group relative shrink-0">
                <button
                  type="button"
                  className="dashboard-customize-icon-button"
                  aria-label="Reorder layout items"
                  aria-pressed={reorderMode}
                  onClick={() => setReorderMode((value) => !value)}
                >
                  <ListOrdered size={15} />
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-[80] mb-2 -translate-x-1/2 whitespace-nowrap rounded-xl border bg-popover px-3.5 py-2.5 text-[13px] leading-relaxed text-popover-foreground shadow-md opacity-0 transition-opacity delay-[350ms] group-hover:opacity-100"
                >
                  Reorder layout items
                </div>
              </div>
              <span className="dashboard-customize-count">{Object.keys(layouts).length} saved</span>
              <Popover.Close
                className="dashboard-customize-icon-button"
                aria-label="Close dashboard layouts"
              >
                <X size={15} />
              </Popover.Close>
            </div>
            <div
              ref={listRef}
              className={`dashboard-customize-results ${sequence.length > 7 ? "dashboard-layout-results-scroll" : ""}`}
            >
              <div className="dashboard-customize-list">
                <div className="px-2 pb-1 pt-1">
                  <div className="text-xs font-medium">Presets</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    Choose a focus, then make it yours with Customize.
                  </div>
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleReorder}
                >
                  <SortableContext items={sequence} strategy={verticalListSortingStrategy}>
                    {sequence.map((entry, index) => {
                      const preset = presets.find((item) => item.name === entry);
                      if (preset) {
                        const active =
                          JSON.stringify(preset.arrangement) === JSON.stringify(current);
                        return (
                          <LayoutRow
                            key={preset.name}
                            name={preset.name}
                            description={preset.description}
                            layout={preset.arrangement}
                            active={active}
                            index={index}
                            custom={false}
                            editing={false}
                            renameName=""
                            reorderMode={reorderMode}
                            onLoad={() => {
                              onLoad(preset.name, preset.arrangement);
                              setOpen(false);
                            }}
                          />
                        );
                      }
                      const layout = normalizeArrangement(layouts[entry], ids);
                      const active = JSON.stringify(layout) === JSON.stringify(current);
                      return (
                        <LayoutRow
                          key={entry}
                          name={entry}
                          layout={layout}
                          active={active}
                          index={index}
                          custom
                          editing={renameTarget === entry}
                          renameName={renameName}
                          reorderMode={reorderMode}
                          onLoad={() => {
                            onLoad(entry, layout);
                            setOpen(false);
                          }}
                          onRename={() => {
                            setRenameTarget(entry);
                            setRenameName(entry);
                            setActionError("");
                          }}
                          onRenameNameChange={setRenameName}
                          onRenameCancel={() => {
                            setRenameTarget(null);
                            setRenameName("");
                            setActionError("");
                          }}
                          onRenameSubmit={submitRename}
                          onReplace={() => setConfirm({ type: "replace", name: entry })}
                          onDelete={() => setConfirm({ type: "delete", name: entry })}
                        />
                      );
                    })}
                  </SortableContext>
                </DndContext>
              </div>
            </div>
            <form
              className="dashboard-layout-save"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                if (!onSave(name.trim())) {
                  setActionError("A layout with that name already exists.");
                  return;
                }
                setSaved(`${name.trim()} saved`);
                setName("");
                setActionError("");
              }}
            >
              <label
                htmlFor={`${titleId}-name`}
                className="text-[11px] font-medium text-muted-foreground"
              >
                Save current layout
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  id={`${titleId}-name`}
                  aria-label="Layout name"
                  placeholder="e.g. Weekly review"
                  value={name}
                  maxLength={80}
                  onChange={(event) => {
                    setName(event.target.value);
                    setSaved("");
                    setActionError("");
                  }}
                  className="h-9 rounded-xl text-xs"
                />
                <Button
                  size="sm"
                  type="submit"
                  className="h-9 shrink-0 rounded-xl"
                  disabled={!name.trim()}
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Button>
              </div>
              {(saved || actionError) && (
                <p
                  role={actionError ? "alert" : "status"}
                  className={`text-[11px] ${actionError ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {actionError || saved}
                </p>
              )}
            </form>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Dialog open={confirm !== null} onOpenChange={(next) => !next && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === "delete" ? "Delete layout?" : "Replace layout?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.type === "delete"
                ? `This will permanently delete “${confirm.name}”.`
                : `This will replace the saved layout “${confirm?.name}” with the current dashboard layout.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant={confirm?.type === "delete" ? "destructive" : "default"}
              onClick={confirmAction}
            >
              {confirm?.type === "delete" ? "Delete" : "Replace"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
