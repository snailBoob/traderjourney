"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { postJson } from "@/lib/use-api";
import { brokerDetails } from "@/lib/brokers";
import type { AccountRow } from "./types";

export function SyncStartDate({
  account,
  disabled,
  refresh,
}: {
  account: AccountRow;
  disabled: boolean;
  refresh: () => void;
}) {
  const details = brokerDetails(account.broker);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [dateValid, setDateValid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (details.startDate === "none") return <span>Not available</span>;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await postJson(
        `/api/accounts/${account.id}`,
        { syncStartAt: date ? `${date}T00:00:00.000Z` : null },
        "PATCH",
      );
      refresh();
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save start date");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="inline-flex min-h-8 items-center gap-2 text-left hover:underline disabled:opacity-50"
        disabled={disabled}
        aria-label={`Edit sync start date for ${account.name}`}
        onClick={() => {
          setDate(account.syncStartAt?.slice(0, 10) ?? "");
          setError(null);
          setDateValid(true);
          setOpen(true);
        }}
      >
        {account.syncStartAt?.slice(0, 10) ?? "Broker default"}
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sync start date</DialogTitle>
            <DialogDescription>{account.name}</DialogDescription>
          </DialogHeader>
          <p className="text-sm leading-relaxed text-muted-foreground">{details.historyNote}</p>
          <DatePicker
            label="Sync start date"
            value={date}
            onValueChange={setDate}
            onValidityChange={setDateValid}
            disabled={busy}
          />
          <p className="text-sm text-muted-foreground">
            Dates are in UTC. This applies to the next sync; existing trades are kept.
            {details.startDate === "optional"
              ? " Leave blank for the broker’s default history."
              : ""}
          </p>
          {error && (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !dateValid || (details.startDate === "required" && !date)}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
