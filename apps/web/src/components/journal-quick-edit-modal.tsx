"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Download, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { RichEditor, type RichEditorHandle } from "@/components/rich-editor";
import { TagInput } from "@/components/tag-input";
import { Field } from "@/components/filter-fields";
import { HoverHint } from "@/components/ui/tooltip";
import { useApi, postJson } from "@/lib/use-api";
import { AttachmentPreview } from "@/components/attachment-preview";

interface RoutineRow {
  id: string;
  title: string;
  stage?: string;
  done?: boolean;
}
interface DayPayload {
  date: string;
  exists: boolean;
  hasAutomaticData: boolean;
  metrics: any;
  startTime: string;
  endTime: string;
  sessionDurationMinutes: number | null;
  trades: any[];
  intraday: any[];
  note: string;
  dailyBiasPlaybooks: string[];
  playbooks: { id: string; name: string }[];
  accordingToDailyBias: number | null;
  dailyBiasStats: {
    matchedTrades: number;
    totalTrades: number;
    matchedPnl: number;
    notMatchedTrades: number;
    notMatchedPnl: number;
  } | null;
  routine: { completed: number; total: number; score: number | null; routines: RoutineRow[] };
  attachments: { id: string; name: string; mime: string; size: number }[];
}
interface BrokerAccountStatus {
  id: string;
  kind: "sync" | "import" | "manual";
  broker: string;
  connected: boolean;
  snapshot: { positions: unknown[]; openOrders: unknown[] } | null;
}
interface BrokerSyncFailure {
  broker: string;
  message: string;
}

export function ScreenshotGrid({
  attachments,
  onLightbox,
  onPendingLightbox,
  pending = [],
  onAddPending,
  onRemovePending,
  onRemoveExisting,
  removed = new Set<string>(),
  allowPdf = false,
  showDownload = false,
}: {
  attachments: { id: string; name: string; mime: string; size: number }[];
  onLightbox: (id: string) => void;
  onPendingLightbox?: (file: File) => void;
  pending?: File[];
  onAddPending?: (files: File[]) => void;
  onRemovePending?: (index: number) => void;
  onRemoveExisting?: (id: string) => void;
  removed?: Set<string>;
  allowPdf?: boolean;
  showDownload?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const add = (files: File[]) =>
    onAddPending?.(
      files.filter(
        (file) =>
          (file.type.startsWith("image/") || (allowPdf && file.type === "application/pdf")) &&
          file.size <= 8 * 1024 * 1024,
      ),
    );
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    add(Array.from(event.dataTransfer.files));
  };
  const onPaste = (event: React.ClipboardEvent) => {
    const files = Array.from(event.clipboardData.files);
    if (files.length) add(files);
  };
  return (
    <div className="space-y-3">
      {onAddPending && (
        <div
          className="rounded-lg border border-dashed p-3"
          onDrop={onDrop}
          onDragOver={(event) => event.preventDefault()}
          onPaste={onPaste}
          tabIndex={0}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => input.current?.click()}
            >
              <Paperclip />
              Add file
            </Button>
            <span className="text-xs text-muted-foreground">
              Paste {allowPdf ? "a file" : "an image"}, drag and drop, or select a file.{" "}
              {allowPdf ? "Images or PDF" : "Images"} up to 8 MB.
            </span>
          </div>
          <input
            ref={input}
            className="hidden"
            type="file"
            aria-label="Upload attachment"
            accept={`image/png,image/jpeg,image/webp${allowPdf ? ",application/pdf" : ""}`}
            multiple
            onChange={(event) => {
              add(Array.from(event.target.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {attachments
          .filter((a) => !removed.has(a.id))
          .map((a) => (
            <div key={a.id} className="relative w-36 rounded-md border p-1">
              <button
                type="button"
                className="block w-full"
                onClick={() => (a.mime.startsWith("image/") || allowPdf) && onLightbox(a.id)}
              >
                {a.mime.startsWith("image/") ? (
                  <img
                    src={`/api/attachments/${a.id}`}
                    alt={a.name}
                    className="h-24 w-full rounded object-contain"
                  />
                ) : (
                  <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                    {a.name}
                  </div>
                )}
              </button>
              {onRemoveExisting && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${a.name}`}
                  title="Remove"
                  className={`absolute right-1 ${showDownload ? "bottom-1" : "top-1"} z-10 h-7 w-7 bg-background/90 text-muted-foreground hover:bg-accent hover:text-foreground`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveExisting(a.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              {(!onAddPending || showDownload) && (
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
              <p
                className={`truncate px-1 py-1 text-[10px] text-muted-foreground ${showDownload ? "min-h-7 pr-8" : ""}`}
              >
                {a.name}
              </p>
            </div>
          ))}
        {pending.map((file, index) => (
          <div key={`${file.name}:${index}`} className="relative w-36 rounded-md border p-1">
            <PendingImage file={file} onClick={() => onPendingLightbox?.(file)} />
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              title="Remove"
              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onRemovePending?.(index);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <p className="truncate px-1 py-1 text-[10px] text-muted-foreground">{file.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingImage({ file, onClick }: { file: File; onClick: () => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <button
      type="button"
      className="block w-full"
      onClick={onClick}
      aria-label={`View ${file.name}`}
    >
      {file.type === "application/pdf" ? (
        <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
          PDF
        </div>
      ) : (
        url && <img src={url} alt={file.name} className="h-24 w-full rounded object-contain" />
      )}
    </button>
  );
}

export function JournalQuickEditModal({
  date,
  mode,
  existingDates,
  timeZone,
  onClose,
  onSaved,
  focusNote = false,
  focusSession = false,
}: {
  date: string;
  mode: "add" | "edit";
  existingDates: string[];
  timeZone: string;
  onClose: () => void;
  onSaved: (date: string) => void;
  focusNote?: boolean;
  focusSession?: boolean;
}) {
  const [selectedDate, setSelectedDate] = useState(date);
  const noteEditorRef = useRef<RichEditorHandle>(null);
  const startTimeRef = useRef<HTMLInputElement>(null);
  const noteEditorId = useId();
  const { data, error } = useApi<DayPayload>(selectedDate ? `/api/journal/${selectedDate}` : null);
  const [note, setNote] = useState("");
  const [bias, setBias] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [openRoutineStage, setOpenRoutineStage] = useState<string | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const uploadIds = useRef(new WeakMap<File, string>());
  const [preview, setPreview] = useState<{ src: string; name: string; mime: string } | null>(null);
  const previewObjectUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    },
    [],
  );
  const closePreview = () => {
    setPreview(null);
    if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    previewObjectUrl.current = null;
  };
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [failure, setFailure] = useState("");
  const [confirmAction, setConfirmAction] = useState<"reset" | "delete" | null>(null);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [initialEndTime, setInitialEndTime] = useState("");
  const [brokerModal, setBrokerModal] = useState<"open" | "sync-error" | null>(null);
  const [syncFailures, setSyncFailures] = useState<BrokerSyncFailure[]>([]);
  useEffect(() => {
    if (data) {
      setNote(data.note);
      setBias(data.dailyBiasPlaybooks);
      setStartTime(data.startTime);
      setEndTime(data.endTime);
      setInitialEndTime(data.endTime);
      setChecks(Object.fromEntries(data.routine.routines.map((r) => [r.id, Boolean(r.done)])));
      setPending([]);
      uploadIds.current = new WeakMap();
      setRemoved(new Set());
      setOpenRoutineStage(null);
      setBrokerModal(null);
      setSyncFailures([]);
    }
  }, [data?.date, data?.exists]);
  useEffect(() => {
    if ((!focusNote && !focusSession) || !data) return;
    const frame = requestAnimationFrame(() => {
      if (focusSession && !data.startTime) startTimeRef.current?.focus();
      else noteEditorRef.current?.focus("end");
    });
    return () => cancelAnimationFrame(frame);
  }, [focusNote, focusSession, data?.date, data?.exists]);
  const effectiveMode: "add" | "edit" = data?.exists ? "edit" : mode;
  const strategyNames = data?.playbooks ?? [];
  const names = bias.map((id) => strategyNames.find((p) => p.id === id)?.name ?? id);
  const setNames = (next: string[]) =>
    setBias(
      next
        .map((name) => strategyNames.find((p) => p.name === name)?.id)
        .filter((id): id is string => Boolean(id)),
    );
  const persist = async () => {
    setBusy(true);
    setFailure("");
    let stage = "journal details";
    try {
      await postJson(
        `/api/journal/${selectedDate}`,
        { note, dailyBiasPlaybooks: bias, startTime, endTime },
        "PUT",
      );
      stage = "routine checks";
      for (const [ruleId, done] of Object.entries(checks))
        await postJson("/api/workspace/progress", { ruleId, date: selectedDate, done });
      stage = "attachment removals";
      for (const id of removed) await postJson(`/api/attachments/${id}`, undefined, "DELETE");
      for (const file of pending) {
        stage = `attachment ${file.name}`;
        let uploadId = uploadIds.current.get(file);
        if (!uploadId) {
          uploadId = crypto.randomUUID();
          uploadIds.current.set(file, uploadId);
        }
        const body = new FormData();
        body.append("type", "day");
        body.append("id", selectedDate);
        body.append("file", file);
        body.append("uploadId", uploadId);
        const response = await fetch("/api/attachments", { method: "POST", body });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
      }
      onSaved(selectedDate);
    } catch (e) {
      setFailure(
        `Save incomplete at ${stage}. Some changes may already be saved. Keep this editor open and retry Save to finish without duplicate uploads. ${e instanceof Error ? e.message : "Connection failed."}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const fetchBrokerAccounts = async () => {
    const response = await fetch("/api/accounts", { cache: "no-store" });
    const result = (await response.json()) as { accounts?: BrokerAccountStatus[]; error?: string };
    if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
    return result.accounts ?? [];
  };
  const checkBrokerState = async () => {
    const accountResult = await fetchBrokerAccounts();
    const connectedAccounts = accountResult.filter(
      (account) => account.kind === "sync" && account.connected,
    );

    const results = await Promise.all(
      connectedAccounts.map(async (account) => {
        try {
          await postJson(`/api/accounts/${account.id}/actions`, { action: "sync" });
          return { account, error: null as string | null };
        } catch (e) {
          return {
            account,
            error: e instanceof Error ? e.message : "Sync failed",
          };
        }
      }),
    );

    const failures = results
      .filter((result) => result.error)
      .map((result) => ({ broker: result.account.broker, message: result.error as string }));
    if (failures.length) return { hasOpenState: false, failures };

    const refreshed = await fetchBrokerAccounts();
    const connectedBrokersHaveOpenState = refreshed
      .filter((account) => account.kind === "sync" && account.connected)
      .some((account) => {
        const snapshot = account.snapshot;
        const hasPosition = (snapshot?.positions?.length ?? 0) > 0;
        const hasOpenOrders =
          account.broker === "bitunix" && (snapshot?.openOrders?.length ?? 0) > 0;
        return hasPosition || hasOpenOrders;
      });
    const manualAccountIds = refreshed
      .filter((account) => account.kind === "manual")
      .map((account) => account.id);
    let manualHasOpenState = false;
    if (manualAccountIds.length) {
      const manualStates = await Promise.all(
        manualAccountIds.map(async (accountId) => {
          const response = await fetch(
            `/api/account-open-status?accountId=${encodeURIComponent(accountId)}`,
            { cache: "no-store" },
          );
          if (!response.ok) throw new Error(`Request failed (${response.status})`);
          const result = (await response.json()) as {
            status?: { positions?: number; openOrders?: number } | null;
          };
          return (result.status?.positions ?? 0) > 0;
        }),
      );
      manualHasOpenState = manualStates.some(Boolean);
    }
    return {
      hasOpenState: connectedBrokersHaveOpenState || manualHasOpenState,
      failures: [] as BrokerSyncFailure[],
    };
  };
  const save = async () => {
    if (!selectedDate || (existingDates.includes(selectedDate) && effectiveMode === "add")) {
      setFailure("Journal day already exists. Use Edit to modify it.");
      return;
    }
    setFailure("");
    const shouldCheckBrokers = !initialEndTime && Boolean(endTime);
    if (shouldCheckBrokers) {
      setBusy(true);
      setSyncing(true);
      try {
        const result = await checkBrokerState();
        setSyncing(false);
        setBusy(false);
        if (result.failures.length) {
          setSyncFailures(result.failures);
          setBrokerModal("sync-error");
          return;
        }
        if (result.hasOpenState) {
          setBrokerModal("open");
          return;
        }
      } catch (e) {
        setSyncing(false);
        setBusy(false);
        setSyncFailures([
          {
            broker: "Broker",
            message: e instanceof Error ? e.message : "Could not sync connected broker accounts.",
          },
        ]);
        setBrokerModal("sync-error");
        return;
      }
    }
    await persist();
  };
  const saveFromBrokerModal = async () => {
    setBrokerModal(null);
    await persist();
  };
  const deleteReset = async () => {
    if (!data?.exists) return;
    setConfirmAction(data.hasAutomaticData ? "reset" : "delete");
  };
  const confirmDeleteReset = async () => {
    if (!data?.exists || !confirmAction) return;
    const modeToRun = confirmAction;
    setConfirmAction(null);
    setBusy(true);
    try {
      await postJson(`/api/journal/${selectedDate}`, { mode: modeToRun }, "DELETE");
      onClose();
      onSaved(selectedDate);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "Could not update Journal day.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "reset" ? "Reset Journal data?" : "Delete Journal day?"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmAction === "reset"
              ? "This will remove the Note, Daily Bias, Routine data and screenshots for this day. Trade data and automatic Journal statistics will not be affected."
              : "This will permanently delete this manually created Journal day and all of its data."}
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmDeleteReset}>
              Confirm
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={brokerModal !== null} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-lg [&>button]:hidden">
          <DialogHeader>
            <DialogTitle>
              {brokerModal === "sync-error" ? "Broker sync failed" : "Open positions or orders"}
            </DialogTitle>
          </DialogHeader>
          {brokerModal === "sync-error" ? (
            <div className="space-y-4">
              <div className="grid grid-cols-[30%_70%] border-y text-sm">
                <div className="border-r px-3 py-2 font-medium">Broker</div>
                <div className="px-3 py-2 font-medium">Message</div>
                {syncFailures.map((failure, index) => {
                  const truncated =
                    failure.message.length > 60
                      ? `${failure.message.slice(0, 60)}...`
                      : failure.message;
                  return (
                    <div key={`${failure.broker}:${index}`} className="contents">
                      <div className="border-r border-t px-3 py-2">{failure.broker}</div>
                      <div className="border-t px-3 py-2">
                        {failure.message.length > 60 ? (
                          <HoverHint content={failure.message} side="top">
                            <span className="block truncate">{truncated}</span>
                          </HoverHint>
                        ) : (
                          failure.message
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-sm text-muted-foreground">Continue to save.</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Be aware that you have open positions or orders on a connected broker.
              <br />
              <br />
              Continue to save.
            </p>
          )}
          <div className="flex justify-end border-t pt-4">
            <Button type="button" onClick={saveFromBrokerModal}>
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
        <DialogContent
          className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
          onPasteCapture={(event) => {
            if (preview || confirmAction || brokerModal || busy) return;
            const files = Array.from(event.clipboardData.files);
            if (!files.length) return;
            event.preventDefault();
            event.stopPropagation();
            const accepted = files.filter(
              (file) =>
                (file.type.startsWith("image/") || file.type === "application/pdf") &&
                file.size <= 8 * 1024 * 1024,
            );
            setPending((current) => [...current, ...accepted]);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {effectiveMode === "add"
                ? selectedDate
                  ? `Add journal day · ${selectedDate}`
                  : "Add journal day"
                : `Edit journal · ${selectedDate}`}
            </DialogTitle>
          </DialogHeader>
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
                <span>Date / Time</span>
                <DatePicker
                  value={selectedDate}
                  onValueChange={setSelectedDate}
                  label="Date"
                  disabledDates={
                    effectiveMode === "add"
                      ? existingDates
                      : existingDates.filter((d) => d !== date)
                  }
                />
              </div>
              <Field label="Start">
                <TimePicker
                  inputRef={startTimeRef}
                  value={startTime}
                  onValueChange={setStartTime}
                  label="Start time"
                />
              </Field>
              <Field label="End">
                <TimePicker value={endTime} onValueChange={setEndTime} label="End time" />
              </Field>
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Field label="Daily Routine">
              {data?.routine.routines.length ? (
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
                  {(["Before trading", "During trading", "After trading"] as const).map((stage) => {
                    const stageRoutines = data.routine.routines.filter(
                      (routine) => routine.stage === stage,
                    );
                    const stageOpen = openRoutineStage === stage;
                    return (
                      <Popover.Root
                        key={stage}
                        open={stageOpen}
                        onOpenChange={(open) => setOpenRoutineStage(open ? stage : null)}
                      >
                        <Popover.Trigger asChild>
                          <button
                            type="button"
                            aria-label={`${stage} routines`}
                            aria-expanded={stageOpen}
                            className="flex h-9 w-full min-w-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-[border-color,box-shadow,background-color] hover:bg-accent/40 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25 focus-visible:border-ring data-[state=open]:border-ring/60"
                          >
                            <span className="truncate">{stage}</span>
                            <ChevronDown className="size-4 shrink-0 opacity-50" />
                          </button>
                        </Popover.Trigger>
                        <Popover.Portal>
                          <Popover.Content
                            align="start"
                            sideOffset={6}
                            collisionPadding={12}
                            aria-label={stage}
                            className="journal-popup journal-menu-surface z-[60] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-24px)] max-h-[min(24rem,var(--radix-popover-content-available-height))] overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-md outline-none"
                          >
                            {stageRoutines.length ? (
                              stageRoutines.map((routine) => (
                                <label
                                  key={routine.id}
                                  className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground data-[disabled]:opacity-50"
                                >
                                  <Checkbox
                                    checked={checks[routine.id] ?? false}
                                    disabled={
                                      busy || selectedDate > new Date().toISOString().slice(0, 10)
                                    }
                                    onCheckedChange={(value) =>
                                      setChecks((current) => ({
                                        ...current,
                                        [routine.id]: value === true,
                                      }))
                                    }
                                  />
                                  <span className="min-w-0 flex-1 break-words">
                                    {routine.title}
                                  </span>
                                </label>
                              ))
                            ) : (
                              <div className="px-2.5 py-2 text-sm text-muted-foreground">
                                No routines in this stage.
                              </div>
                            )}
                          </Popover.Content>
                        </Popover.Portal>
                      </Popover.Root>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-9 items-center rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground">
                  No routines scheduled for this date.
                </div>
              )}
            </Field>
            <div className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
              <label htmlFor={noteEditorId}>Note</label>
              <RichEditor
                visual
                id={noteEditorId}
                editorRef={noteEditorRef}
                templateScope="journal"
                mode="edit"
                showModeToggle={false}
                showTradeLink
                showDictate
                compact
                value={note}
                onChange={setNote}
              />
            </div>
            <Field label="Daily Bias">
              <TagInput
                value={names}
                suggestions={strategyNames.map((p) => p.name)}
                placeholder="Select strategies"
                closeOnSelect={false}
                onChange={setNames}
              />
            </Field>
            <div className="grid min-w-0 gap-1 text-xs text-muted-foreground">
              <span>Files</span>
              <ScreenshotGrid
                allowPdf
                attachments={data?.attachments ?? []}
                pending={pending}
                removed={removed}
                onLightbox={(id) =>
                  setPreview({
                    src: `/api/attachments/${id}`,
                    mime: data?.attachments.find((attachment) => attachment.id === id)?.mime ?? "",
                    name:
                      data?.attachments.find((attachment) => attachment.id === id)?.name ??
                      "Journal image",
                  })
                }
                onPendingLightbox={(file) => {
                  const src = URL.createObjectURL(file);
                  previewObjectUrl.current = src;
                  setPreview({ src, name: file.name, mime: file.type });
                }}
                onAddPending={(files) => setPending((current) => [...current, ...files])}
                onRemovePending={(index) => {
                  const file = pending[index];
                  const uploadId = file && uploadIds.current.get(file);
                  // An interrupted upload may already exist on the server.
                  if (uploadId) setRemoved((current) => new Set(current).add(uploadId));
                  setPending((current) => current.filter((_, i) => i !== index));
                }}
                onRemoveExisting={(id) => setRemoved((current) => new Set(current).add(id))}
              />
            </div>
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" disabled={busy} onClick={save}>
                {syncing ? "Syncing…" : busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </fieldset>
        </DialogContent>
      </Dialog>
      <Dialog open={preview !== null} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-w-6xl p-4" aria-describedby={undefined}>
          <DialogTitle className="sr-only">{preview?.name ?? "Image preview"}</DialogTitle>
          {preview && <AttachmentPreview key={preview.src} {...preview} onClose={closePreview} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
