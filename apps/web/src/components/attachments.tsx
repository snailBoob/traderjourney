"use client";
import { HoverHint } from "./ui/tooltip";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { Download, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { postJson, useApi } from "@/lib/use-api";
import { ScreenshotGrid } from "./journal-quick-edit-modal";
import { AttachmentPreview } from "./attachment-preview";

type Attachment = { id: string; name: string; mime: string; size: number };

export function Attachments({
  type,
  id,
  actionContainer,
  layout,
  uploadRef,
}: {
  type: "trade" | "day" | "note" | "missed" | "prop-account" | "prop-entry";
  id: string;
  actionContainer?: HTMLElement | null;
  layout?: "files";
  uploadRef?: Ref<(files: File[]) => void>;
}) {
  const { data, error, refresh } = useApi<{
    attachments: Attachment[];
  }>(`/api/attachments?type=${type}&id=${encodeURIComponent(id)}`);
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const upload = async (files: File[]) => {
    setBusy(true);
    setFailure("");
    try {
      for (const file of files) {
        const body = new FormData();
        body.append("type", type);
        body.append("id", id);
        body.append("file", file);
        const response = await fetch("/api/attachments", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      refresh();
    }
  };
  useImperativeHandle(uploadRef, () => upload);
  const uploadButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => input.current?.click()}
    >
      <Paperclip />
      {busy ? "Uploading…" : "Add attachment"}
    </Button>
  );
  return (
    <div className="space-y-3 border-t pt-3">
      {layout === "files" ? (
        <fieldset disabled={busy} className="grid min-w-0 gap-1 text-xs text-muted-foreground">
          <legend className="mb-1">Files</legend>
          <ScreenshotGrid
            allowPdf
            showDownload
            attachments={data?.attachments ?? []}
            onAddPending={(files) => {
              if (!busy) void upload(files);
            }}
            onLightbox={(id) =>
              setPreview(data?.attachments.find((item) => item.id === id) ?? null)
            }
            onRemoveExisting={(id) => {
              const attachment = data?.attachments.find((item) => item.id === id);
              if (attachment) setDeleteTarget(attachment);
            }}
          />
          {busy && <span role="status">Uploading…</span>}
        </fieldset>
      ) : actionContainer !== undefined ? (
        actionContainer &&
        createPortal(
          <HoverHint content="Images or PDF · up to 8 MB each">{uploadButton}</HoverHint>,
          actionContainer,
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {uploadButton}
          <span className="text-xs text-muted-foreground">Images or PDF · up to 8 MB each</span>
        </div>
      )}
      {layout !== "files" && (
        <input
          ref={input}
          aria-label="Upload attachment"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="hidden"
          multiple
          onChange={(event) => void upload(Array.from(event.target.files ?? []))}
        />
      )}
      {(failure || error) && (
        <p role="alert" className="text-xs text-destructive">
          {failure || error}
        </p>
      )}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-5xl" aria-describedby={undefined}>
          <DialogTitle>{preview?.name}</DialogTitle>
          {preview && (
            <AttachmentPreview
              key={preview.id}
              src={`/api/attachments/${preview.id}`}
              name={preview.name}
              mime={preview.mime}
              onClose={() => setPreview(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove attachment?</DialogTitle>
            <DialogDescription>
              This will permanently remove “{deleteTarget?.name}”.
            </DialogDescription>
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
                try {
                  await postJson(`/api/attachments/${deleteTarget.id}`, undefined, "DELETE");
                  setDeleteTarget(null);
                  refresh();
                } catch (e) {
                  setFailure(String(e));
                }
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {layout !== "files" && (
        <div className={type === "note" ? "grid grid-cols-4 gap-2" : "grid grid-cols-2 gap-2"}>
          {data?.attachments.map((a) => (
            <div key={a.id} className="relative min-w-0 rounded-md border p-2">
              {type === "note" && (
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  title="Download"
                  className="absolute right-1 top-1 z-10 h-7 w-7 bg-background/90 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <a
                    href={`/api/attachments/${a.id}`}
                    download={a.name}
                    aria-label={`Download ${a.name}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </Button>
              )}
              <HoverHint content={a.name}>
                <a
                  href={`/api/attachments/${a.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block"
                  onClick={(event) => {
                    if (type !== "note") return;
                    event.preventDefault();
                    setPreview(a);
                  }}
                >
                  {a.mime.startsWith("image/") && (
                    <img
                      src={`/api/attachments/${a.id}`}
                      alt={a.name}
                      className={
                        type === "note"
                          ? "mx-auto mb-2 h-auto w-full rounded object-contain"
                          : "mb-2 h-28 w-full rounded object-contain"
                      }
                    />
                  )}
                  <span className="block truncate text-xs underline">{a.name}</span>
                </a>
              </HoverHint>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>{Math.round(a.size / 1024)} KB</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 hover:text-destructive"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => setDeleteTarget({ id: a.id, name: a.name })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
