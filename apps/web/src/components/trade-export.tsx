"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { OptionSelect } from "@/components/ui/option-select";
import { useApi } from "@/lib/use-api";

export function TradeExport() {
  const [accountId, setAccountId] = useState("");
  const { data, error: accountError } = useApi<{
    accounts: { id: string; name: string; archivedAt: string | null }[];
  }>("/api/accounts");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const invalid = Boolean(from && to && from > to);

  async function download(format: "csv" | "pdf") {
    setBusy(format);
    setError("");
    try {
      const params = new URLSearchParams({ format });
      if (accountId) params.set("accounts", accountId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const response = await fetch(`/api/export?${params}`);
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Export failed.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `trades-${from || "start"}-${to || "latest"}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export trades</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Export trades from all accounts or select one account. Dates include both days and use
          your journal time zone: closing date for closed trades, opening date for open trades.
          Leave dates empty for all history.
        </p>
        <div className="space-y-2">
          <Label htmlFor="export-account">Account</Label>
          <OptionSelect id="export-account" value={accountId} onValueChange={setAccountId}>
            <option value="">All accounts</option>
            {(data?.accounts ?? []).map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.archivedAt ? " (archived)" : ""}
              </option>
            ))}
          </OptionSelect>
          {accountError && (
            <p role="alert" className="text-sm text-destructive">
              {accountError}
            </p>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>From</Label>
            <DatePicker label="From" value={from} max={to || undefined} onValueChange={setFrom} />
          </div>
          <div className="space-y-2">
            <Label>To</Label>
            <DatePicker label="To" value={to} min={from || undefined} onValueChange={setTo} />
          </div>
        </div>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            From must be on or before To.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3" aria-busy={Boolean(busy)}>
          <Button disabled={invalid || Boolean(busy)} onClick={() => download("csv")}>
            <Download className="h-4 w-4" />
            {busy === "csv" ? "Exporting…" : "Download CSV"}
          </Button>
          <Button
            variant="outline"
            disabled={invalid || Boolean(busy)}
            onClick={() => download("pdf")}
          >
            <Download className="h-4 w-4" />
            {busy === "pdf" ? "Exporting…" : "Download PDF"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
