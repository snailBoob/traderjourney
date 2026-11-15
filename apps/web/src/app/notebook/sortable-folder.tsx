"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { HTMLAttributes } from "react";

export function SortableFolder({
  id,
  disabled,
  allowScroll = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { id: string; disabled: boolean; allowScroll?: boolean }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  return (
    <div
      {...props}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        touchAction: allowScroll ? "pan-y" : "none",
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.65 : undefined,
      }}
    />
  );
}
