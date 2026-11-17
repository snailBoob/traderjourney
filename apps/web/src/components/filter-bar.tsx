"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { dayKeyOf, FILTER_KEYS, readFilters, type AnalysisFilters } from "@traderjourney/core";
import { JournalQuickEditModal } from "@/components/journal-quick-edit-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilterFields } from "./filter-fields";
import {
  ChartCandlestick,
  ClipboardList,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { AccountSelector } from "./account-selector";
import { postJson, useApi } from "@/lib/use-api";
import { publishHeaderNotice, subscribeHeaderNotice } from "@/lib/header-notice";
import { runSync, useSyncStatus, setSyncFailure } from "@/lib/sync-status";
export type FilterScope = "standard" | "journal" | "missed";
export type FilterValues = AnalysisFilters & {
  missedRuleFollowed?: string;
  routine?: string;
  dailyBias?: string;
  capitalBasis?: string;
  entries?: string;
};

export const useFilters = (scope: FilterScope = "standard") => {
  const params = useSearchParams();
  const { data } = useApi<{ timeZone: string }>("/api/settings");
  const range = params.get("range") ?? "all",
    timeZone = data?.timeZone ?? "UTC";
  return useMemo(() => {
    const f = readFilters(new URLSearchParams(params.toString()));
    const entries = params.get("entries") ?? f.lastTrades;
    delete f.lastTrades;
    const today = dayKeyOf(new Date().toISOString(), timeZone);
    if (range === "ytd") {
      f.from = `${today.slice(0, 4)}-01-01`;
      f.to = today;
    } else if (["7d", "30d", "90d"].includes(range)) {
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - Number(range.slice(0, -1)) + 1);
      f.from = d.toISOString().slice(0, 10);
      f.to = today;
    }
    const values: FilterValues =
      scope === "missed"
        ? {
            ...f,
            missedRuleFollowed: params.get("missedRuleFollowed") ?? undefined,
            capitalBasis: params.get("capitalBasis") ?? undefined,
            entries,
          }
        : scope === "journal"
          ? {
              ...f,
              routine: params.get("routine") ?? undefined,
              dailyBias: params.get("dailyBias") ?? undefined,
              capitalBasis: params.get("capitalBasis") ?? undefined,
              entries,
            }
          : {
              ...f,
              capitalBasis: params.get("capitalBasis") ?? undefined,
              entries,
            };
    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string" && value) queryParams.set(key, value);
    }
    return {
      accounts: f.accounts ?? null,
      from: f.from ?? null,
      to: f.to ?? null,
      range,
      timeZone,
      values,
      query: queryParams.toString(),
    };
  }, [params, range, timeZone, scope]);
};
export type Filters = ReturnType<typeof useFilters>;
type SyncAccountStatus = {
  id: string;
  name: string;
  kind: "sync" | "import" | "manual";
  connected: boolean;
};
type AccountOpenStatus = { accountId: string; positions: number; openOrders: number };
export function FilterBar({
  title,
  actions,
  primaryAction,
  scope = "journal",
  showSync = false,
  showEditToday = false,
  showFilters: showFiltersOverride,
  showHeaderMessage = true,
}: {
  title: string;
  actions?: React.ReactNode;
  primaryAction?: React.ReactNode;
  scope?: FilterScope;
  showSync?: boolean;
  showEditToday?: boolean;
  showFilters?: boolean;
  showHeaderMessage?: boolean;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const filters = useFilters(scope);
  const showFilters =
    showFiltersOverride ??
    (["/", "/reports", "/trades", "/calendar", "/journal", "/strategies", "/missed"].includes(
      pathname,
    ) ||
      pathname.startsWith("/journal/"));
  const { data: headerSettings } = useApi<{ timeZone: string; headerMessage: string }>(
    "/api/settings",
  );
  const { data: accountStatus } = useApi<{ accounts: SyncAccountStatus[] }>("/api/accounts");
  const selectedAccountIds = params.get("accounts")?.split(",").filter(Boolean) ?? [];
  const selectedSingleAccountId = selectedAccountIds.length === 1 ? selectedAccountIds[0] : null;
  const accountOpenStatusUrl =
    selectedAccountIds.length === 0
      ? "/api/account-open-status"
      : selectedSingleAccountId
        ? `/api/account-open-status?accountId=${encodeURIComponent(selectedSingleAccountId)}`
        : "";
  const { data: accountOpenStatus } = useApi<{ status: AccountOpenStatus | null }>(
    accountOpenStatusUrl,
  );
  const hasConnectedBroker =
    accountStatus?.accounts.some((account) => account.kind === "sync" && account.connected) ??
    false;
  const { syncing, syncFailure } = useSyncStatus();
  const [syncShortcut, setSyncShortcut] = useState("Ctrl + Shift + S");
  useEffect(() => {
    const platform = navigator.platform ?? "";
    setSyncShortcut(/Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘ + Shift + S" : "Ctrl + Shift + S");
  }, []);
  const [sharedHeaderNotice, setSharedHeaderNotice] = useState<string | null>(null);
  const [sharedHeaderNoticeVisible, setSharedHeaderNoticeVisible] = useState(false);
  useEffect(
    () =>
      subscribeHeaderNotice((message, visible) => {
        setSharedHeaderNotice(message);
        setSharedHeaderNoticeVisible(visible);
      }),
    [],
  );
  const [quickEditOpen, setQuickEditOpen] = useState(false);
  const { data: journalIndex } = useApi<{ existingDates: string[] }>("/api/journal?view=dates");
  const messages = useMemo(
    () =>
      (headerSettings?.headerMessage ?? "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    [headerSettings?.headerMessage],
  );
  const headerMessage = useMemo(() => {
    if (!messages.length) return "";
    const zone = headerSettings?.timeZone ?? "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const key = parts
      .filter((part) => ["year", "month", "day"].includes(part.type))
      .map((part) => part.value)
      .join("-");
    const day = Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000);
    return messages[((day % messages.length) + messages.length) % messages.length] ?? "";
  }, [headerSettings?.timeZone, messages]);
  const sync = useCallback(async () => {
    await runSync(async () => {
      const result = await postJson<{
        inserted: number;
        corrected: number;
        newTrades: number;
        failedAccounts: number;
        skipped: number;
        syncedAccounts: number;
        failures: { accountId: string; error: string }[];
      }>("/api/sync", {});
      if (result.failedAccounts > 0) {
        const summary =
          result.syncedAccounts > 0
            ? `Sync partially completed: ${result.syncedAccounts} account(s) synced, ${result.failedAccounts} failed. ${result.newTrades} new trades and ${result.corrected ?? 0} corrected fills were saved; ${result.skipped} fills were skipped.`
            : `Sync failed for all ${result.failedAccounts} account(s). No account completed this sync. Check the errors below before syncing again.`;
        setSyncFailure({
          summary,
          failures: result.failures.map((failure) => ({
            account:
              accountStatus?.accounts.find((account) => account.id === failure.accountId)?.name ??
              failure.accountId,
            error: failure.error,
          })),
        });
        publishHeaderNotice("Sync needs attention. See the account errors in the dialog.");
      } else if (result.corrected > 0) {
        publishHeaderNotice(
          `Sync complete — ${result.inserted} new fills, ${result.corrected} corrected fills`,
        );
      } else if (result.inserted > 0) {
        publishHeaderNotice(
          `Sync complete — ${result.newTrades} new trade${result.newTrades === 1 ? "" : "s"}`,
        );
      } else {
        publishHeaderNotice("Sync complete — no new data");
      }
    });
  }, [accountStatus]);
  useEffect(() => {
    if (!hasConnectedBroker) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "s" ||
        !event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]'))
      )
        return;
      event.preventDefault();
      void sync();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [hasConnectedBroker, sync]);
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<FilterValues>({});
  const filterTitle = useRef<HTMLHeadingElement>(null);
  const count = Object.entries(filters.values).filter(
    ([key, value]) =>
      key !== "capitalBasis" && typeof value === "string" && value.trim().length > 0,
  ).length;
  const apply = () => {
    const next = new URLSearchParams(params.toString());
    FILTER_KEYS.forEach((k) => next.delete(k));
    next.delete("missedRuleFollowed");
    next.set("range", "custom");
    next.delete("page");
    next.delete("routine");
    next.delete("dailyBias");
    next.delete("entries");
    for (const [k, v] of Object.entries(draft)) if (typeof v === "string" && v) next.set(k, v);
    router.replace(`${pathname}?${next}`);
    setOpen(false);
  };
  return (
    <>
      <div className="journal-page-title-sticky sticky z-20 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
      </div>
      <div
        className={`journal-filter-bar sticky journal-filter-bar-route-${pathname === "/" ? "dashboard" : pathname.slice(1).replaceAll("/", "-") || "dashboard"} z-10 flex min-h-14 min-w-0 items-center gap-4 border-b bg-background/95 px-4 py-2 backdrop-blur ${pathname === "/" ? "max-[1439px]:hidden" : ""}`}
      >
        <div className="min-w-0 shrink-0 pr-1 text-left">
          <div className="flex min-w-0 items-center gap-8">
            <h1 className="min-w-0 shrink-0 text-base font-semibold tracking-tight">{title}</h1>
            {accountOpenStatus?.status && (
              <div
                aria-label={`${accountOpenStatus.status.positions} open positions, ${accountOpenStatus.status.openOrders} open orders`}
                className="hidden min-[1440px]:flex h-8 w-[92px] shrink-0 items-center justify-center gap-2 rounded-lg border bg-muted/50 px-2 text-xs text-muted-foreground shadow-none"
              >
                <span
                  className="flex items-center gap-1"
                  title={`${accountOpenStatus.status.positions} open ${accountOpenStatus.status.positions === 1 ? "position" : "positions"}`}
                >
                  <ChartCandlestick className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{accountOpenStatus.status.positions}</span>
                </span>
                <span aria-hidden="true" className="text-border">
                  ·
                </span>
                <span
                  className="flex items-center gap-1"
                  title={`${accountOpenStatus.status.openOrders} open ${accountOpenStatus.status.openOrders === 1 ? "order" : "orders"}`}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{accountOpenStatus.status.openOrders}</span>
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1 px-2 text-center">
          {sharedHeaderNotice ? (
            <span
              role="status"
              className={`text-xs font-bold text-muted-foreground transition-opacity duration-300 ${sharedHeaderNoticeVisible ? "opacity-100" : "opacity-0"}`}
            >
              {sharedHeaderNotice}
            </span>
          ) : (
            showHeaderMessage &&
            headerMessage && (
              <span className="text-xs italic text-muted-foreground">{headerMessage}</span>
            )
          )}
        </div>
        <div className="journal-filter-controls flex min-w-0 shrink-0 items-center justify-end gap-2">
          {showFilters && (scope === "standard" || scope === "missed") && (
            <div className="journal-account-control">
              <AccountSelector />
            </div>
          )}
          {showFilters && (
            <>
              <div className="journal-days-control flex max-w-full shrink-0 items-center rounded-md border p-0.5">
                {["7d", "30d", "90d", "ytd", "all"].map((range) => (
                  <Button
                    key={range}
                    variant={filters.range === range ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      const next = new URLSearchParams(params.toString());
                      next.set("range", range);
                      next.delete("page");
                      next.delete("from");
                      next.delete("to");
                      router.replace(`${pathname}?${next}`);
                    }}
                  >
                    {range === "all" ? "All" : range.toUpperCase()}
                  </Button>
                ))}
              </div>
              <Button
                className="journal-filters-control"
                variant="outline"
                size="sm"
                title="Filter by dates, symbols, strategy, outcome, and more. All selected conditions must match."
                onClick={() => {
                  setDraft(filters.values);
                  setOpen(true);
                }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {pathname === "/calendar" ? "Filter" : `Filters${count > 0 ? ` · ${count}` : ""}`}
              </Button>
            </>
          )}
          {actions && !["/routines", "/strategies"].includes(pathname) && (
            <div className="journal-header-actions journal-page-actions flex min-w-0 max-w-full flex-nowrap items-center gap-2">
              {actions}
            </div>
          )}
          {showSync && pathname !== "/calendar" && hasConnectedBroker && (
            <Button
              className="journal-sync-control"
              variant="outline"
              size="sm"
              title={syncShortcut}
              aria-keyshortcuts="Meta+Shift+S Control+Shift+S"
              onClick={() => void sync()}
              disabled={syncing}
            >
              <RefreshCw className={syncing ? "animate-spin" : undefined} />
              {syncing ? "Syncing…" : "Sync"}
            </Button>
          )}
          {actions && ["/routines", "/strategies"].includes(pathname) && (
            <div className="journal-header-actions journal-page-actions flex min-w-0 max-w-full flex-nowrap items-center gap-2">
              {actions}
            </div>
          )}
          {showEditToday &&
            (pathname === "/journal" ? (
              <Button
                className={`journal-edit-today-control ${primaryAction ? "" : "bg-black text-white hover:bg-black/90 hover:text-white dark:bg-white dark:text-black dark:hover:bg-white/90 dark:hover:text-black"}`}
                size="sm"
                variant={primaryAction ? "outline" : "default"}
                onClick={() => {
                  const next = new URLSearchParams(params.toString());
                  if (next.get("edit") === "today") next.delete("edit");
                  else next.set("edit", "today");
                  router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
                }}
              >
                <Pencil />
                Edit today
              </Button>
            ) : (
              <Button
                className="journal-edit-today-control"
                size="sm"
                variant="outline"
                onClick={() => setQuickEditOpen((value) => !value)}
              >
                <Pencil />
                Edit today
              </Button>
            ))}
          {primaryAction && (
            <div className="journal-header-primary-action journal-primary-action shrink-0">
              {primaryAction}
            </div>
          )}
        </div>
      </div>
      {pathname === "/" && (
        <div className="journal-dashboard-mobile-controls flex flex-col gap-2 border-b bg-background/95 px-3 py-2 backdrop-blur min-[1440px]:hidden">
          {showFilters && (
            <div className="min-w-0 [&>div]:w-full [&_button]:w-full">
              <AccountSelector />
            </div>
          )}
          {showFilters && (
            <div className="flex min-w-0 items-center gap-1 rounded-md border p-0.5">
              {["7d", "30d", "90d", "ytd", "all"].map((range) => (
                <Button
                  key={range}
                  variant={filters.range === range ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8 min-w-0 flex-1 px-1 text-xs"
                  onClick={() => {
                    const next = new URLSearchParams(params.toString());
                    next.set("range", range);
                    next.delete("page");
                    next.delete("from");
                    next.delete("to");
                    router.replace(`${pathname}?${next}`);
                  }}
                >
                  {range === "all" ? "All" : range.toUpperCase()}
                </Button>
              ))}
            </div>
          )}
          <div className="flex min-w-0 gap-2">
            {showFilters && (
              <Button
                variant="outline"
                size="sm"
                className="min-w-0 flex-1"
                onClick={() => {
                  setDraft(filters.values);
                  setOpen(true);
                }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {`Filters${count > 0 ? ` · ${count}` : ""}`}
              </Button>
            )}
            {showSync && hasConnectedBroker && (
              <Button
                variant="outline"
                size="sm"
                className="min-w-0 flex-1"
                title={syncShortcut}
                aria-keyshortcuts="Meta+Shift+S Control+Shift+S"
                onClick={() => void sync()}
                disabled={syncing}
              >
                <RefreshCw className={syncing ? "animate-spin" : undefined} />
                {syncing ? "Syncing…" : "Sync"}
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {showEditToday && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => setQuickEditOpen((value) => !value)}
              >
                <Pencil />
                Edit today
              </Button>
            )}
            {primaryAction && <div className="min-w-0 [&>button]:w-full">{primaryAction}</div>}
          </div>
        </div>
      )}
      {quickEditOpen &&
        pathname !== "/journal" &&
        (() => {
          const today = dayKeyOf(new Date().toISOString(), filters.timeZone);
          return (
            <JournalQuickEditModal
              focusSession
              date={today}
              mode={journalIndex?.existingDates?.includes(today) ? "edit" : "add"}
              existingDates={journalIndex?.existingDates ?? []}
              timeZone={filters.timeZone}
              onClose={() => setQuickEditOpen(false)}
              onSaved={() => {
                setQuickEditOpen(false);
                window.dispatchEvent(new Event("tj:api-refresh"));
              }}
            />
          );
        })()}
      <Dialog open={syncFailure !== null} onOpenChange={(next) => !next && setSyncFailure(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync needs attention</DialogTitle>
            <DialogDescription>{syncFailure?.summary}</DialogDescription>
          </DialogHeader>
          {syncFailure && syncFailure.failures.length > 0 && (
            <ul className="space-y-3 text-sm">
              {syncFailure.failures.map((failure, index) => (
                <li key={index}>
                  <p className="font-medium">{failure.account}</p>
                  <p className="text-muted-foreground">{failure.error}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setSyncFailure(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="journal-filter-dialog sm:max-w-3xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            filterTitle.current?.focus();
          }}
        >
          <DialogHeader className="journal-filter-heading">
            <DialogTitle ref={filterTitle} tabIndex={-1} className="outline-none">
              {scope === "missed"
                ? "Filter your missed trades"
                : scope === "journal"
                  ? "Filter your journal"
                  : "Filter your trades"}
            </DialogTitle>
            <DialogDescription className="journal-filter-description">
              {scope === "missed"
                ? "Dates use the observation date. All selected conditions must match."
                : scope === "journal"
                  ? "Filters select Journal days. All trades and full day statistics remain visible within a selected day."
                  : `Times use ${filters.timeZone}. Dates use the closing day, or opening day for open trades. All selected conditions must match.`}
            </DialogDescription>
          </DialogHeader>
          <div className="journal-filter-body">
            <FilterFields
              value={draft}
              onChange={setDraft}
              scope={scope}
              showEntries={["/journal", "/trades", "/missed", "/reports"].includes(pathname)}
            />
          </div>
          <div className="journal-filter-footer flex items-center justify-start gap-3">
            <Button className="min-w-28" onClick={apply}>
              Apply filters
            </Button>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setDraft({})}
            >
              Clear filters
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
