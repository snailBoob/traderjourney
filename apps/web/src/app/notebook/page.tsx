"use client";
import { MobileFolderSelect } from "./mobile-folder-select";

import { Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Filter,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { VoiceNote } from "@/components/voice-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Attachments } from "@/components/attachments";
import { useAutosave } from "@/lib/use-autosave";
import { postJson, useApi } from "@/lib/use-api";
import { cn } from "@/lib/utils";
import { saveUiPreference, useUiPreferences } from "@/lib/ui-preferences-client";
import { orderedItems } from "@/lib/ordered-items";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableFolder } from "./sortable-folder";

interface NoteRow {
  id: string;
  folderId: string;
  title: string;
  content: string;
  updatedAt: string;
}

interface FolderRow {
  id: string;
  name: string;
  kind: string;
}

export default function NotebookPage() {
  return (
    <Suspense>
      <Notebook />
    </Suspense>
  );
}

function Notebook() {
  const [folder, setFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [focusTitleId, setFocusTitleId] = useState<string | null>(null);
  const [createNoteError, setCreateNoteError] = useState("");
  const [creatingNote, setCreatingNote] = useState(false);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [moveError, setMoveError] = useState("");
  const [moving, setMoving] = useState(false);
  const { data: uiSettings, error: settingsError } = useUiPreferences();
  const [noteOrder, setNoteOrder] = useState<string[] | "oldest" | "newest">();
  const [savingOrder, setSavingOrder] = useState(false);
  const [preferenceError, setPreferenceError] = useState("");
  const selectionWrites = useRef(Promise.resolve());
  const lastSelection = useRef<string | undefined>(undefined);
  const [folderOrder, setFolderOrder] = useState<string[] | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const { data, refresh } = useApi<{ notes: NoteRow[]; folders: FolderRow[] }>("/api/notes");
  const order = noteOrder ?? uiSettings?.preferences.notebookNoteOrder;
  const allNotes =
    order === "oldest"
      ? [...(data?.notes ?? [])].reverse()
      : orderedItems(data?.notes ?? [], order);
  const query = search.toLowerCase();
  const visibleNotes = allNotes.filter(
    (note) =>
      (folder === "all" || note.folderId === folder) &&
      (note.title.toLowerCase().includes(query) || note.content.toLowerCase().includes(query)),
  );
  const preferredId =
    selectedId === undefined ? uiSettings?.preferences.notebookCurrentNote : selectedId;
  const selected =
    (!uiSettings && !settingsError) || selectedId === null
      ? null
      : (visibleNotes.find((note) => note.id === preferredId) ??
        (selectedId === undefined ? visibleNotes[0] : null));
  const currentId = selected?.id;
  useEffect(() => {
    if (!currentId || !uiSettings) return;
    setSelectedId(currentId);
    if ((lastSelection.current ?? uiSettings.preferences.notebookCurrentNote) === currentId) return;
    lastSelection.current = currentId;
    selectionWrites.current = selectionWrites.current.then(async () => {
      try {
        await saveUiPreference("notebookCurrentNote", currentId);
      } catch {
        lastSelection.current = undefined;
        setPreferenceError("Could not save the current note.");
      }
    });
  }, [currentId, uiSettings]);
  const changeOrder = async (next: NonNullable<typeof noteOrder>) => {
    if (savingOrder || !uiSettings) return;
    setSavingOrder(true);
    setPreferenceError("");
    setNoteOrder(next);
    try {
      await saveUiPreference("notebookNoteOrder", next);
    } catch {
      setNoteOrder(noteOrder);
      setPreferenceError("Could not save the note order.");
    } finally {
      setSavingOrder(false);
    }
  };
  const reorderNotes = (fromId: string, toId: string) => {
    const ids = visibleNotes.map((note) => note.id);
    const from = ids.indexOf(fromId),
      to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;
    const moved = arrayMove(ids, from, to);
    const visible = new Set(ids);
    let i = 0;
    void changeOrder(allNotes.map((note) => (visible.has(note.id) ? moved[i++]! : note.id)));
  };
  const sortLabel = `Sort by last modified: ${order === "oldest" ? "newest" : "oldest"} first`;
  const orderedFolders = orderedItems(
    (data?.folders ?? []).filter((item) => item.id !== "all"),
    folderOrder ?? uiSettings?.preferences.notebookFolderOrder,
  );
  const reorderFolders = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || ordering) return;
    const ids = orderedFolders.map((item) => item.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    const previous = folderOrder;
    setFolderOrder(next);
    setOrdering(true);
    setOrderError("");
    try {
      await saveUiPreference("notebookFolderOrder", next);
    } catch (error) {
      setFolderOrder(previous);
      setOrderError(error instanceof Error ? error.message : "Could not save folder order.");
    } finally {
      setOrdering(false);
    }
  };
  const selectFolder = (next: string) => {
    setFolder(next);
    setSelectedId(undefined);
  };
  const moveNote = async (note: NoteRow, folderId: string) => {
    if (moving || note.folderId === folderId) return;
    setMoving(true);
    setMoveError("");
    try {
      await postJson(`/api/notes/${note.id}`, { folderId }, "PATCH");
      refresh();
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Could not move note");
      throw error;
    } finally {
      setMoving(false);
    }
  };

  const createNote = async () => {
    if (creatingNote) return;
    setCreatingNote(true);
    setCreateNoteError("");
    try {
      const result = await postJson<{ id: string }>("/api/notes", {
        folderId: folder === "all" ? "my-notes" : folder,
        title: "New note",
      });
      setSearch("");
      refresh();
      setFocusTitleId(result.id);
      setSelectedId(result.id);
    } catch (error) {
      setCreateNoteError(error instanceof Error ? error.message : "Could not create note");
    } finally {
      setCreatingNote(false);
    }
  };

  const startEditFolder = (folder: FolderRow) => {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  };

  const saveFolderName = async () => {
    if (!editingFolderId || savingFolder) return;
    const name = editingFolderName.trim();
    if (!name) return;
    setSavingFolder(true);
    try {
      await postJson("/api/folders", { id: editingFolderId, name }, "PATCH");
      setEditingFolderId(null);
      setEditingFolderName("");
      refresh();
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : "Could not rename the folder.");
    } finally {
      setSavingFolder(false);
    }
  };

  const deleteFolder = async (folderId: string) => {
    try {
      await postJson("/api/folders", { id: folderId }, "DELETE");
      if (folder === folderId) setFolder("all");
      setDeletingFolderId(null);
      setSelectedId(null);
      refresh();
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : "Could not delete the folder.");
    }
  };

  const createFolder = async () => {
    if (creatingFolder || !folderName.trim()) return;
    setCreatingFolder(true);
    setFolderError("");
    try {
      const result = await postJson<{ id: string }>("/api/folders", { name: folderName });
      setFolder(result.id);
      setSelectedId(null);
      setSearch("");
      refresh();
      setFolderOpen(false);
      setFolderName("");
    } catch (error) {
      setFolderError(
        error instanceof Error ? error.message : "Could not create the folder. Try again.",
      );
    } finally {
      setCreatingFolder(false);
    }
  };

  return (
    <div>
      <Dialog open={folderOpen} onOpenChange={(open) => !creatingFolder && setFolderOpen(open)}>
        <DialogContent>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>Organize your notes in a named folder.</DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void createFolder();
            }}
          >
            <label className="block space-y-2 text-sm">
              <span>Folder name</span>
              <Input
                autoFocus
                value={folderName}
                maxLength={100}
                required
                disabled={creatingFolder}
                onChange={(event) => {
                  setFolderName(event.target.value);
                  setFolderError("");
                }}
              />
            </label>
            {folderError && (
              <p role="alert" className="text-sm text-destructive">
                {folderError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={creatingFolder}
                onClick={() => setFolderOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creatingFolder || !folderName.trim()}>
                {creatingFolder ? "Creating…" : "Create folder"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deletingFolderId)}
        onOpenChange={(open) => !open && setDeletingFolderId(null)}
      >
        <DialogContent>
          <DialogTitle>Delete folder</DialogTitle>
          <DialogDescription>Notes in this folder will stay in All Notes.</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeletingFolderId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deletingFolderId && void deleteFolder(deletingFolderId)}
            >
              Delete folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <FilterBar
        title="Notebook"

        actions={
          <Button
            size="sm"
            className="bg-black text-white hover:bg-black/90 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-black"
            disabled={creatingNote}
            onClick={() => void createNote()}
          >
            <Plus />
            Add note
          </Button>
        }
      />
      {createNoteError && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {createNoteError}
        </p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={(args) =>
          String(args.active.id).startsWith("note:")
            ? pointerWithin(args)
            : closestCenter({
                ...args,
                droppableContainers: args.droppableContainers.filter(
                  (c) => !String(c.id).startsWith("note:"),
                ),
              })
        }
        onDragOver={({ active, over }) =>
          setDropFolder(
            String(active.id).startsWith("note:") && over && !String(over.id).startsWith("note:")
              ? String(over.id)
              : null,
          )
        }
        onDragCancel={() => setDropFolder(null)}
        onDragEnd={(event) => {
          setDropFolder(null);
          const { active, over } = event;
          if (!over) return;
          if (!String(active.id).startsWith("note:")) {
            void reorderFolders(event);
            return;
          }
          const noteId = String(active.id).slice(5);
          if (String(over.id).startsWith("note:")) reorderNotes(noteId, String(over.id).slice(5));
          else {
            const note = visibleNotes.find((n) => n.id === noteId);
            if (note) void moveNote(note, String(over.id)).catch(() => {});
          }
        }}
      >
        <div className="notebook-workspace" data-note-open={Boolean(selected)}>
          <div className="notebook-folders min-w-0 space-y-0.5 overflow-y-auto border-r p-2">
            <button
              className={cn(
                "w-full rounded-md px-2.5 py-1.5 text-left text-sm",
                folder === "all"
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
              onClick={() => selectFolder("all")}
            >
              All Notes
            </button>
            {orderError && (
              <p role="alert" className="px-2 text-sm text-destructive">
                {orderError}
              </p>
            )}
            <SortableContext
              items={orderedFolders.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedFolders.map((f) => {
                const editable = f.id !== "all";
                const editing = editingFolderId === f.id;
                return editing ? (
                  <div key={f.id} className="flex items-center gap-1 rounded-md px-1 py-0.5">
                    <Input
                      autoFocus
                      value={editingFolderName}
                      maxLength={100}
                      aria-label={`Folder name ${f.name}`}
                      className="h-8 min-w-0 flex-1 px-2 text-sm"
                      onChange={(event) => setEditingFolderName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setEditingFolderId(null);
                          return;
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveFolderName();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Save folder name"
                      disabled={savingFolder || !editingFolderName.trim()}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void saveFolderName()}
                    >
                      <Check />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Cancel folder name edit"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setEditingFolderId(null)}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <SortableFolder
                    key={f.id}
                    id={f.id}
                    disabled={ordering || !uiSettings || Boolean(editingFolderId)}
                    className={cn(
                      "group relative rounded-md px-1",
                      dropFolder === f.id && "ring-2 ring-ring bg-accent",
                      folder === f.id
                        ? "bg-accent font-medium"
                        : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    <button
                      className="w-full min-w-0 whitespace-nowrap rounded-md bg-transparent px-1.5 py-1.5 pr-16 text-left text-sm hover:bg-transparent"
                      onClick={() => selectFolder(f.id)}
                    >
                      {f.name}
                    </button>
                    {editable && (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-9 top-1/2 z-10 h-8 w-8 -translate-y-1/2 bg-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          title="Rename folder"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => startEditFolder(f)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-1 top-1/2 z-10 h-8 w-8 -translate-y-1/2 bg-transparent text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background/70 hover:text-destructive focus-visible:opacity-100"
                          title="Delete folder"
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={() => setDeletingFolderId(f.id)}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </SortableFolder>
                );
              })}
            </SortableContext>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => {
                setFolderError("");
                setFolderOpen(true);
              }}
            >
              <FolderPlus />
              New folder
            </Button>
          </div>

          <div className="notebook-list min-w-0 overflow-y-auto border-r">
            <div className="sticky top-0 z-[1] space-y-2 border-b bg-background p-2">
              {moveError && (
                <p role="alert" className="text-sm text-destructive">
                  {moveError}
                </p>
              )}
              <div className="flex min-w-0 items-center gap-2 xl:hidden">
                <MobileFolderSelect
                  value={folder}
                  folders={orderedFolders}
                  onSelect={selectFolder}
                  onReorder={(event) => void reorderFolders(event)}
                  disabled={ordering || !uiSettings}
                  error={orderError}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  aria-label="New folder"
                  onClick={() => {
                    setFolderError("");
                    setFolderOpen(true);
                  }}
                >
                  <FolderPlus />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search notes"
                    className="pl-8"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={!uiSettings || savingOrder}
                  title={sortLabel}
                  aria-label={sortLabel}
                  onClick={() => void changeOrder(order === "oldest" ? "newest" : "oldest")}
                >
                  <Filter />
                </Button>
              </div>
              {(preferenceError || settingsError) && (
                <p role="alert" className="text-sm text-destructive">
                  {preferenceError || settingsError}
                </p>
              )}
            </div>
            {data && visibleNotes.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">No notes here yet.</p>
            )}
            <SortableContext
              items={visibleNotes.map((note) => `note:${note.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {visibleNotes.map((note) => (
                <SortableFolder
                  key={note.id}
                  id={`note:${note.id}`}
                  disabled={moving || savingOrder || !uiSettings}
                >
                  <button
                    className={cn(
                      "block w-full min-w-0 border-b px-3 py-2.5 text-left hover:bg-accent/40",
                      selected?.id === note.id && "bg-accent/60",
                    )}
                    onClick={() => setSelectedId(note.id)}
                  >
                    <div className="truncate text-sm font-medium">{note.title || "Untitled"}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {note.updatedAt.slice(0, 10)} · {note.content.slice(0, 60) || "empty"}
                    </div>
                  </button>
                </SortableFolder>
              ))}
            </SortableContext>
          </div>

          <div className="notebook-editor min-w-0 overflow-y-auto p-3 sm:p-4">
            {selected && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mb-3 md:hidden"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft />
                Back to notes
              </Button>
            )}
            {selected ? (
              <NoteEditor
                key={selected.id}
                note={selected}
                focusTitle={focusTitleId === selected.id}
                onTitleFocused={() => setFocusTitleId(null)}
                folders={data?.folders ?? []}
                onChanged={refresh}
                onMove={(folderId) => moveNote(selected, folderId)}
                moving={moving}
              />
            ) : (
              <p className="py-24 text-center text-sm text-muted-foreground">
                Select or create a note.
              </p>
            )}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function NoteEditor({
  note,
  focusTitle,
  onTitleFocused,
  folders,
  onChanged,
  onMove,
  moving,
}: {
  note: NoteRow;
  focusTitle: boolean;
  onTitleFocused: () => void;
  folders: FolderRow[];
  onChanged: () => void;
  onMove: (folderId: string) => Promise<void>;
  moving: boolean;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [moveOpen, setMoveOpen] = useState(false);
  const editor = useRef<RichEditorHandle>(null);
  const upload = useRef<(files: File[]) => void>(null);
  const notePane = useRef<HTMLDivElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const { save: queueSave, status } = useAutosave(`/api/notes/${note.id}`, "PATCH", onChanged);
  const save = (title: string, content: string) => queueSave({ title, content });

  useEffect(() => {
    const routePaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        document.querySelector('[role="dialog"]') ||
        !event.clipboardData
      )
        return;
      if (
        !notePane.current?.contains(target) &&
        target.closest('input, textarea, [contenteditable="true"]')
      )
        return;
      const files = Array.from(event.clipboardData.files);
      const text = event.clipboardData.getData("text/plain");
      if (!files.length && (!text || target.closest('[contenteditable="true"]'))) return;
      event.preventDefault();
      event.stopPropagation();
      if (files.length) upload.current?.(files);
      else editor.current?.appendPlainText?.(text);
    };
    document.addEventListener("paste", routePaste, true);
    return () => document.removeEventListener("paste", routePaste, true);
  }, []);

  return (
    <div ref={notePane} className="space-y-4">
      <div className="flex items-center gap-1">
        <Input
          autoFocus={focusTitle}
          onFocus={(event) => {
            if (focusTitle) {
              event.currentTarget.select();
              onTitleFocused();
            }
          }}
          value={title}
          maxLength={200}
          onChange={(event) => {
            const next = event.target.value;
            setTitle(next);
            if (next.trim()) save(next.trim(), content);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setTitle(note.title);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const next = title.trim();
              if (next) {
                setTitle(next);
                save(next, content);
              }
            }
          }}
          onBlur={() => {
            const next = title.trim();
            if (!next) {
              setTitle(note.title);
            } else if (next !== note.title) {
              setTitle(next);
              save(next, content);
            }
          }}
          className="notebook-editor-title min-w-0 border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
          placeholder="Title"
        />
        {!status.startsWith("Not saved:") && (
          <span role="status" className="ml-auto shrink-0 text-xs text-muted-foreground">
            {status}
          </span>
        )}
      </div>
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogTitle>Move note</DialogTitle>
          <DialogDescription>Choose a destination folder.</DialogDescription>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {folders
              .filter((folder) => folder.id !== "all")
              .map((folder) => (
                <Button
                  key={folder.id}
                  variant="ghost"
                  className="min-h-11 w-full justify-start"
                  disabled={moving || folder.id === note.folderId}
                  onClick={async () => {
                    try {
                      await onMove(folder.id);
                      setMoveOpen(false);
                    } catch (error) {
                      setMessage(error instanceof Error ? error.message : "Could not move note");
                    }
                  }}
                >
                  {folder.name}
                  {folder.id === note.folderId ? " (current)" : ""}
                </Button>
              ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={message !== null} onOpenChange={(open) => !open && setMessage(null)}>
        <DialogContent>
          <DialogTitle>Action failed</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setMessage(null)}>
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogTitle>Delete note?</DialogTitle>
          <DialogDescription>This will permanently delete this note.</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={async () => {
                try {
                  await postJson(`/api/notes/${note.id}`, undefined, "DELETE");
                  setDeleteOpen(false);
                  onChanged();
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : "Could not delete note");
                }
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <RichEditor
        visual
        templateScope="notebook"
        editorRef={editor}
        showModeToggle={false}
        toolbarClassName="notebook-entry-actions"
        toolbarStart={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="xl:hidden shrink-0"
            onClick={() => setMoveOpen(true)}
          >
            Move to…
          </Button>
        }
        toolbarEnd={
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <VoiceNote
              onPrepare={() => editor.current?.focus()}
              onText={(text) => {
                const next = content ? `${content}\n\n${text}` : text;
                setContent(next);
                save(title, next);
              }}
            />
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </div>
        }
        value={content}
        onChange={(value) => {
          setContent(value);
          save(title, value);
        }}
      />
      {status.startsWith("Not saved:") && (
        <p role="alert" className="text-sm text-destructive">
          {status}
        </p>
      )}
      <Attachments type="note" id={note.id} layout="files" uploadRef={upload} />
    </div>
  );
}
