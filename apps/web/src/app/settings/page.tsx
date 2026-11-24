"use client";

import { Suspense, useEffect, useState } from "react";
import { JournalDefaultSettings } from "@/components/journal-default-settings";
import { McpSettings } from "@/components/mcp-settings";
import { DemoSettings } from "@/components/demo-settings";
import { SecuritySettings } from "@/components/security-settings";
import { Trash2 } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeZonePicker } from "@/components/timezone-picker";
import { Label } from "@/components/ui/label";
import { postJson, useApi } from "@/lib/use-api";

interface SettingsPayload {
  timeZone: string;
  importTimeZone: string;
  multipliers: Record<string, number>;
  headerMessage: string;
}

export default function SettingsPage() {
  return (
    <Suspense>
      <Settings />
    </Suspense>
  );
}

function Settings() {
  const { data, refresh } = useApi<SettingsPayload>("/api/settings");
  const [timeZone, setTimeZone] = useState("");
  const [importTimeZone, setImportTimeZone] = useState("");
  const [multipliers, setMultipliers] = useState("");
  const [headerMessage, setHeaderMessage] = useState("");
  const [headerMessageSaved, setHeaderMessageSaved] = useState(false);
  const [headerMessageFailure, setHeaderMessageFailure] = useState("");
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState("");
  const [clearMissedOpen, setClearMissedOpen] = useState(false);
  const [clearMissedBusy, setClearMissedBusy] = useState(false);
  const [clearMissedError, setClearMissedError] = useState("");

  useEffect(() => {
    if (data) {
      setTimeZone(data.timeZone);
      setImportTimeZone(data.importTimeZone);
      setHeaderMessage(data.headerMessage ?? "");
      setMultipliers(
        Object.entries(data.multipliers)
          .map(([symbol, multiplier]) => `${symbol}=${multiplier}`)
          .join("\n"),
      );
    }
  }, [data]);

  const save = async () => {
    const parsedMultipliers: Record<string, number> = {};
    for (const line of multipliers.split("\n")) {
      const [symbol, value] = line.split("=").map((part) => part.trim());
      if (symbol && value && Number.isFinite(Number(value))) {
        parsedMultipliers[symbol.toUpperCase()] = Number(value);
      }
    }
    try {
      await postJson(
        "/api/settings",
        { timeZone, importTimeZone, multipliers: parsedMultipliers },
        "PATCH",
      );
      setFailure("");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Save failed");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    refresh();
  };

  return (
    <div>
      <FilterBar title="Settings" showHeaderMessage={false} />
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <SecuritySettings />
        <JournalDefaultSettings />
        <Card>
          <CardHeader>
            <CardTitle>Journal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label
                htmlFor="display-timezone"
                className="mb-1 block text-xs text-muted-foreground"
              >
                Display timezone (IANA)
              </Label>
              <TimeZonePicker
                id="display-timezone"
                label="Display timezone"
                value={timeZone}
                onValueChange={setTimeZone}
                disabled={!data}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Trade times, calendars, journal days, and analytics use this timezone.
              </p>
              <button
                className="mt-1 text-xs text-muted-foreground underline"
                onClick={() => setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
              >
                Use this device's timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone})
              </button>
            </div>
            <div>
              <Label htmlFor="import-timezone" className="mb-1 block text-xs text-muted-foreground">
                Default import timezone (IANA)
              </Label>
              <TimeZonePicker
                id="import-timezone"
                label="Default import timezone"
                value={importTimeZone}
                onValueChange={setImportTimeZone}
                disabled={!data}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Used for timestamps without an offset in file imports and IBKR broker sync. You can
                override it for each file. Existing trades are not changed; correcting an IBKR
                account's timezone requires a separate account for recovery.
              </p>
            </div>
            <div>
              <Label className="mb-1 block text-xs text-muted-foreground">
                Contract multipliers (futures/options) — one per line, SYMBOL=multiplier
              </Label>
              <textarea
                value={multipliers}
                onChange={(event) => setMultipliers(event.target.value)}
                placeholder={"ES=50\nNQ=20\nMES=5"}
                className="flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Saving multipliers recalculates existing trade P&L from fills and preserves
              annotations.
            </p>
            {failure && (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            )}
            <Button onClick={save} disabled={!data}>
              {saved ? "Saved ✓" : "Save"}
            </Button>
          </CardContent>
        </Card>

        <McpSettings />
        <DemoSettings />

        <Card>
          <CardHeader>
            <CardTitle>Header message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Add personal messages that will be displayed in the header. Put each message on a
              separate line. Commas stay part of the message. One message will be shown each day.
            </p>
            <textarea
              value={headerMessage}
              onChange={(event) => setHeaderMessage(event.target.value)}
              placeholder="One message per line"
              className="flex min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
            {headerMessageFailure && (
              <p role="alert" className="text-xs text-destructive">
                {headerMessageFailure}
              </p>
            )}
            <Button
              onClick={async () => {
                try {
                  await postJson("/api/settings", { headerMessage }, "PATCH");
                  setHeaderMessageFailure("");
                  setHeaderMessageSaved(true);
                  setTimeout(() => setHeaderMessageSaved(false), 1500);
                  refresh();
                } catch (e) {
                  setHeaderMessageFailure(e instanceof Error ? e.message : "Save failed");
                }
              }}
              disabled={!data}
            >
              {headerMessageSaved ? "Saved ✓" : "Save"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Missed trades</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Remove all entries in the missed trades section.
                </p>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setClearMissedError("");
                    setClearMissedOpen(true);
                  }}
                >
                  <Trash2 />
                  Remove all entries
                </Button>
              </div>
              {clearMissedError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {clearMissedError}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={clearMissedOpen}
        onOpenChange={(next) => !next && !clearMissedBusy && setClearMissedOpen(false)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete all missed trades?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all missed trades? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={clearMissedBusy}
              onClick={() => setClearMissedOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={clearMissedBusy}
              onClick={async () => {
                setClearMissedBusy(true);
                setClearMissedError("");
                try {
                  await postJson("/api/workspace/missed", { all: true }, "DELETE");
                  setClearMissedOpen(false);
                } catch (e) {
                  setClearMissedError(
                    e instanceof Error ? e.message : "Could not delete missed trades.",
                  );
                } finally {
                  setClearMissedBusy(false);
                }
              }}
            >
              {clearMissedBusy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
