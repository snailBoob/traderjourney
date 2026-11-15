"use client";

import { useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BackupRestore() {
  const [action, setAction] = useState<"create" | "restore" | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [restored, setRestored] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  function open(next: "create" | "restore", button: HTMLButtonElement) {
    trigger.current = button;
    setPassword("");
    setConfirmation("");
    setError("");
    setAction(next);
  }

  function close() {
    if (busy) return;
    setAction(null);
    setPassword("");
    setConfirmation("");
    setError("");
  }

  async function run() {
    if (!action || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/backup?action=${action}`, {
        method: "POST",
        headers: {
          "x-journal-backup": "1",
          "x-backup-password": encodeURIComponent(password),
          "Content-Type": "application/zip",
        },
        body: action === "restore" ? file : undefined,
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Backup operation failed.");
      }
      if (action === "create") {
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download =
          response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
          "Tradejournal_backup.zip";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        setRestored(true);
      }
      setAction(null);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The result could not be confirmed. Reload to check the current data.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup and restore</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {restored ? (
          <div className="space-y-3" role="status">
            <p className="text-sm">Backup restored. Reload to use the restored data.</p>
            <Button onClick={() => window.location.assign("/")}>Open restored journal</Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Save your full journal as a ZIP. Password protection is optional.
              </p>
              <Button className="w-52" onClick={(event) => open("create", event.currentTarget)}>
                <Download className="h-4 w-4" />
                Backup
              </Button>
            </div>
            <div className="space-y-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Restore replaces your current journal data. A password is only needed for protected
                ZIPs.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".zip,application/zip"
                  aria-label="Backup ZIP file"
                  className="hidden"
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    event.target.value = "";
                    if (!selected) return;
                    if (
                      !selected.name.toLowerCase().endsWith(".zip") ||
                      selected.size > 512 * 1024 * 1024
                    ) {
                      setFile(null);
                      setFileError("Choose a backup ZIP of up to 512 MiB.");
                    } else {
                      setFile(selected);
                      setFileError("");
                    }
                  }}
                />
                <Button
                  className="w-52"
                  variant="destructive"
                  disabled={!file}
                  onClick={(event) => open("restore", event.currentTarget)}
                >
                  Restore and replace data
                </Button>
                <Button variant="outline" onClick={() => fileInput.current?.click()}>
                  <FileUp className="h-4 w-4" />
                  Select backup ZIP file
                </Button>
              </div>
              {file && (
                <p className="break-all text-sm text-muted-foreground" role="status">
                  {file.name}
                </p>
              )}
              {fileError && (
                <p role="alert" className="text-sm text-destructive">
                  {fileError}
                </p>
              )}
            </div>
          </>
        )}
        <Dialog
          open={action !== null}
          onOpenChange={(value) => {
            if (!value) close();
          }}
        >
          <DialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{action === "create" ? "Create backup" : "Restore backup"}</DialogTitle>
              <DialogDescription>
                {action === "create"
                  ? "Password optional. Leave empty for an unprotected ZIP, or use at least 12 characters."
                  : "Leave the password empty for an unprotected ZIP. Otherwise, enter its password."}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="backup-password">
                  {action === "create"
                    ? "Backup password (optional)"
                    : "Password for this backup (if protected)"}
                </Label>
                <Input
                  id="backup-password"
                  type="password"
                  autoComplete={action === "create" ? "new-password" : "off"}
                  minLength={12}
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={busy}
                />
              </div>
              {action === "create" && (
                <div className="space-y-2">
                  <Label htmlFor="backup-confirm">Repeat password</Label>
                  <Input
                    id="backup-confirm"
                    type="password"
                    autoComplete="new-password"
                    maxLength={1024}
                    required={password.length > 0}
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    disabled={busy}
                  />
                </div>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {busy && (
                <p role="status" className="text-sm text-muted-foreground">
                  Keep this window open until the operation finishes.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={close}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={action === "restore" ? "destructive" : "default"}
                  disabled={
                    busy ||
                    (password.length > 0 && password.length < 12) ||
                    (action === "create" && password !== confirmation)
                  }
                >
                  {busy
                    ? action === "create"
                      ? "Creating backup…"
                      : "Checking and restoring…"
                    : action === "create"
                      ? "Download backup ZIP"
                      : "Restore and replace data"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
