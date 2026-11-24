"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp } from "lucide-react";
import { AccountPicker } from "@/components/account-picker";
import { FilterBar } from "@/components/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { postJson, useApi } from "@/lib/use-api";
import { decodeImportFile } from "@/lib/decode-import";
import { formatTimestamp, isTimeZone } from "@/lib/timezone";
import { dayKeyOf } from "@traderjourney/core";
import { ImportReconciliation } from "@/components/import-reconciliation";
import type { ImportReview, ImportReviewOptions } from "@/lib/import-review";
import { TimeZonePicker } from "@/components/timezone-picker";
import { TradeExport } from "@/components/trade-export";
import { BackupRestore } from "@/components/backup-restore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PreviewTotals {
  executions: number;
  symbols: number;
  skippedRows: number;
  from: string | null;
  to: string | null;
}

interface PreviewResponse {
  reconciliation?: ImportReview;
  detected: string | null;
  timeZone: string;
  needsMapping?: boolean;
  headers?: string[];
  totals?: PreviewTotals;
  warnings?: string[];
  errors?: string[];
  needsSymbol?: boolean;
  executions?: {
    symbol: string;
    side: string;
    quantity: number;
    price: number;
    fee?: number;
    executedAt: string;
  }[];
}

export default function ImportPage() {
  return (
    <Suspense>
      <ImportView />
    </Suspense>
  );
}

function ImportView() {
  return (
    <div>
      <FilterBar title="Import/Export" showHeaderMessage={false} />
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <TradeExport />
        <FileImport />
        <BackupRestore />
      </div>
    </div>
  );
}

function FileImport() {
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [reviewOptions, setReviewOptions] = useState<ImportReviewOptions>({});
  const changeReview = (options: ImportReviewOptions) => {
    setReviewOptions(options);
    setPreview((current) =>
      current
        ? {
            ...current,
            reconciliation: current.reconciliation
              ? { ...current.reconciliation, token: null }
              : undefined,
          }
        : null,
    );
  };
  const [content, setContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mappingApplied, setMappingApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const { data: formatData } = useApi<{ formats: { id: string; label: string }[] }>("/api/import");
  const { data: settingsData, error: settingsError } = useApi<{
    timeZone: string;
    importTimeZone: string;
  }>("/api/settings");
  const [statementTimeZone, setStatementTimeZone] = useState<string | null>(null);
  const timeZone = statementTimeZone ?? settingsData?.importTimeZone ?? "";
  const validTimeZone = isTimeZone(timeZone);
  const displayTimeZone = settingsData?.timeZone ?? "UTC";

  const onFile = async (file: File) => {
    if (!validTimeZone) return;
    setStatementTimeZone(timeZone);
    setPreview(null);
    setContent(null);
    setFileName(file.name);
    setReviewOptions({});
    setSymbol("");
    setMapping({});
    setMappingApplied(false);
    setError(null);
    setBusy(true);
    try {
      if (/\.pdf$/i.test(file.name))
        throw new Error("Use a CSV, HTML or XML statement export instead of PDF.");
      const text = decodeImportFile(await file.arrayBuffer());
      setContent(text);
      setPreview(
        await postJson<PreviewResponse>("/api/import", {
          mode: "preview",
          content: text,
          accountId: accountId || undefined,
          review: {},
          fileName: file.name,
          timeZone,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import preview failed");
    } finally {
      setBusy(false);
    }
  };

  const previewFile = async () => {
    if (!content || !validTimeZone) return;
    setPreview(null);
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await postJson<PreviewResponse>("/api/import", {
          mode: "preview",
          content,
          accountId: accountId || undefined,
          review: reviewOptions,
          fileName,
          symbol,
          timeZone,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import preview failed");
    } finally {
      setBusy(false);
    }
  };

  const previewWithMapping = async () => {
    if (!content || !validTimeZone) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(
        await postJson<PreviewResponse>("/api/import", {
          mode: "preview",
          content,
          mapping,
          timeZone,
        }),
      );
      setMappingApplied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import preview failed");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!content || !accountId || !preview) return;
    setBusy(true);
    try {
      const result = await postJson<{
        inserted: number;
        duplicates: number;
        corrected?: number;
        skipped?: number;
        warnings?: string[];
      }>("/api/import", {
        mode: "commit",
        review: { ...reviewOptions, previewToken: preview.reconciliation?.token ?? undefined },
        content,
        accountId,
        mapping: mappingApplied ? mapping : undefined,
        fileName,
        symbol,
        // Commit with the exact parsing zone used by the reviewed preview.
        timeZone: preview.timeZone,
      });
      const skippedNote =
        result.skipped && result.skipped > 0
          ? ` ${result.skipped} invalid rows were skipped: ${(result.warnings ?? []).at(-1) ?? ""}`
          : "";
      setMessage({
        title: "Import completed",
        body: `Imported ${result.inserted} executions (${result.duplicates} duplicates skipped, ${result.corrected ?? 0} fee corrections).${skippedNote}`,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const mappingFields = ["symbol", "side", "quantity", "price", "fee", "timestamp"] as const;

  return (
    <div className="space-y-3">
      <Dialog open={message !== null} onOpenChange={(open) => !open && setMessage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{message?.title}</DialogTitle>
            <DialogDescription>{message?.body}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => {
                setMessage(null);
                if (message?.title === "Import completed")
                  router.push(`/?accounts=${encodeURIComponent(accountId)}`);
              }}
            >
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>Upload a statement or export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label
              htmlFor="statement-timezone"
              className="mb-1 block text-xs text-muted-foreground"
            >
              Statement timezone (IANA)
            </Label>
            <TimeZonePicker
              id="statement-timezone"
              label="Statement timezone"
              value={timeZone}
              disabled={busy || !settingsData}
              describedBy="statement-timezone-help"
              onValueChange={(zone) => {
                setStatementTimeZone(zone);
                setPreview(null);
                setMappingApplied(false);
              }}
            />
            <p id="statement-timezone-help" className="mt-1 text-xs text-muted-foreground">
              Choose the timezone used by your broker's statement. Timestamps with an explicit
              offset keep that offset. Your journal displays times in {displayTimeZone}.
            </p>
            {timeZone && !validTimeZone && (
              <p role="alert" className="mt-1 text-xs text-loss">
                Enter a valid IANA timezone, such as Europe/Helsinki.
              </p>
            )}
            {settingsError && (
              <p role="alert" className="mt-1 text-xs text-loss">
                {settingsError}
              </p>
            )}
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center hover:border-ring">
            <FileUp className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm">{fileName || "Choose a CSV / HTML / XML statement"}</span>
            <span className="text-xs text-muted-foreground">
              {formatData?.formats?.length ? (
                <>
                  Auto-detected:{" "}
                  {formatData.formats.map((format) => format.label.split(" (")[0]).join(", ")} —
                  anything else via column mapping.
                </>
              ) : (
                "Import format detection is unavailable; use column mapping if needed."
              )}
            </span>
            <input
              type="file"
              accept=".csv,.txt,.htm,.html,.tsv,.xml"
              disabled={busy || !settingsData || !validTimeZone}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
                event.target.value = "";
              }}
            />
          </label>
          {content && !preview && (
            <Button onClick={previewFile} disabled={busy || !validTimeZone} variant="outline">
              {busy ? "Reading…" : "Preview file"}
            </Button>
          )}

          {error && (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          )}
          {preview?.needsSymbol && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 text-xs text-muted-foreground">
                Symbol
                <Input
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  placeholder="AAPL, EURUSD…"
                  className="mt-1"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={previewFile}
                disabled={busy || !symbol.trim()}
              >
                Preview
              </Button>
            </div>
          )}
          {preview?.needsMapping && preview.headers && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm">
                Format not recognized — map your columns (nothing is guessed silently):
              </p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {mappingFields.map((field) => (
                  <div key={field}>
                    <Label className="mb-1 block text-xs capitalize text-muted-foreground">
                      {field}
                      {field === "fee" ? " (optional)" : ""}
                    </Label>
                    <Select
                      value={mapping[field] ?? "none"}
                      onValueChange={(value) =>
                        setMapping((m) => ({ ...m, [field]: value === "none" ? "" : value }))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="column" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {preview.headers!.map((header) => (
                          <SelectItem key={header} value={header}>
                            {header}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                onClick={previewWithMapping}
                disabled={
                  busy ||
                  !mapping.symbol ||
                  !mapping.side ||
                  !mapping.quantity ||
                  !mapping.price ||
                  !mapping.timestamp
                }
              >
                Preview with mapping
              </Button>
            </div>
          )}

          {preview && !preview.needsMapping && preview.totals && (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{preview.detected}</Badge>
                <span>{preview.totals.executions} executions</span>
                <span className="text-muted-foreground">· {preview.totals.symbols} symbols</span>
                {preview.totals.from && (
                  <span className="text-muted-foreground">
                    · {dayKeyOf(preview.totals.from, displayTimeZone)} →{" "}
                    {preview.totals.to && dayKeyOf(preview.totals.to, displayTimeZone)}
                  </span>
                )}
                {preview.totals.skippedRows > 0 && (
                  <span className="text-muted-foreground">
                    · {preview.totals.skippedRows} rows skipped
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Statement timezone: {preview.timeZone}. Preview times: {displayTimeZone}.
              </p>
              {!!preview.executions?.length && (
                <div className="space-y-1 border-t pt-2 text-xs">
                  <div className="space-y-1">
                    {preview.executions.slice(0, 5).map((execution, index) => (
                      <div key={index}>
                        <div className="flex flex-wrap gap-x-3">
                          <span>
                            {execution.symbol} · {execution.side.toUpperCase()}
                          </span>
                          <span className="text-muted-foreground">
                            {formatTimestamp(execution.executedAt, displayTimeZone)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {preview.totals.executions > 5 && (
                    <p className="text-muted-foreground">Showing the first 5 executions.</p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {preview.detected === "ninjatrader"
                  ? "Recovering an older NinjaTrader import or correcting its timezone? Import the complete history into a new journal account, then compare totals. Keep the original account and its reviews until you have verified the recovery."
                  : "Correcting a previous import? Remove the affected trades before importing again with a different timezone to avoid duplicates. Back up your data first."}
              </p>
              {preview.warnings?.map((warning, index) => (
                <p key={index} className="text-xs text-muted-foreground">
                  ⚠ {warning}
                </p>
              ))}
              {!preview.needsSymbol &&
                preview.errors?.map((message, index) => (
                  <p key={index} role="alert" className="text-xs text-loss">
                    {message}
                  </p>
                ))}
              <fieldset disabled={busy}>
                <AccountPicker
                  value={accountId}
                  onChange={(id) => {
                    setAccountId(id);
                    setReviewOptions({});
                    setPreview((current) =>
                      current ? { ...current, reconciliation: undefined } : null,
                    );
                  }}
                  kind="import"
                />
              </fieldset>
              {preview.detected === "ninjatrader" && accountId && (
                <ImportReconciliation
                  review={preview.reconciliation}
                  options={reviewOptions}
                  onChange={changeReview}
                  onReview={previewFile}
                  busy={busy}
                />
              )}
              <Button
                onClick={commit}
                disabled={
                  !accountId ||
                  busy ||
                  !!preview.errors?.length ||
                  !preview.totals.executions ||
                  (preview.detected === "ninjatrader" && !preview.reconciliation?.token)
                }
              >
                {busy ? "Importing…" : "Import"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
