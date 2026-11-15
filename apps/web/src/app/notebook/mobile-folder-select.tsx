"use client";

import { useState } from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ChevronDown } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button";
import { SortableFolder } from "./sortable-folder";

export function MobileFolderSelect({
  folders,
  value,
  onSelect,
  onReorder,
  disabled,
  error,
}: {
  folders: { id: string; name: string }[];
  value: string;
  onSelect: (id: string) => void;
  onReorder: (event: DragEndEvent) => void;
  disabled: boolean;
  error: string;
}) {
  const [open, setOpen] = useState(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const select = (id: string) => {
    onSelect(id);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="outline"
          aria-label="Note folder"
          className="min-h-11 min-w-0 flex-1 justify-between"
        >
          <span className="truncate">
            {value === "all" ? "All Notes" : folders.find((folder) => folder.id === value)?.name}
          </span>
          <ChevronDown className="size-4 shrink-0" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="journal-popup z-50 max-h-[min(60dvh,var(--radix-popover-content-available-height))] w-72 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Hold a folder to reorder. Drag after the long press.
          </p>
          {error && (
            <p role="alert" className="p-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            variant="ghost"
            className="min-h-11 w-full justify-start"
            onClick={() => select("all")}
          >
            All Notes
          </Button>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
            <SortableContext
              items={folders.map((folder) => folder.id)}
              strategy={verticalListSortingStrategy}
            >
              {folders.map((folder) => (
                <SortableFolder
                  key={folder.id}
                  id={folder.id}
                  disabled={disabled}
                  allowScroll
                  className="rounded-md"
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <Button
                    variant={folder.id === value ? "secondary" : "ghost"}
                    className="min-h-11 w-full justify-start whitespace-normal text-left"
                    onClick={() => select(folder.id)}
                  >
                    {folder.name}
                  </Button>
                </SortableFolder>
              ))}
            </SortableContext>
          </DndContext>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
