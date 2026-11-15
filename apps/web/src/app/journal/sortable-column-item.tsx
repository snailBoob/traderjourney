"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { useId } from "react";
export function SortableColumnItem({
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
  const checkboxId = useId();
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
      <label
        htmlFor={checkboxId}
        className="journal-column-toggle flex min-h-11 cursor-pointer items-center gap-1.5 sm:min-h-0"
      >
        <Checkbox
          id={checkboxId}
          checked={visible}
          onCheckedChange={(value) => onVisible(value === true)}
        />
        <span className="text-sm">{label}</span>
      </label>
    </div>
  );
}
