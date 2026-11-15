"use client";

import { MonetaryField, MonetaryValue } from "@/components/privacy";
import { BrokerLogo } from "@/components/broker-logo";
import { brokerDetails, connectionStatus } from "@/lib/brokers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HoverHint } from "@/components/ui/tooltip";
import { postJson } from "@/lib/use-api";
import { fmtMoney } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import {
  Archive,
  ArchiveRestore,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CircleHelp,
  Clock3,
  Database,
  GripVertical,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AccountRow } from "./types";
import { SyncStartDate } from "./sync-start-date";
const AccountDragHandleContext = createContext<ReactNode>(null);
export function AccountCard({
  account,
  editingNameId,
  editingName,
  setEditingNameId,
  setEditingName,
  saveAccountName,
  syncing,
  sync,
  action,
  refresh,
  setConfirmAction,
  onTransfer,
}: {
  account: AccountRow;
  editingNameId: string | null;
  editingName: string;
  setEditingNameId: (id: string | null) => void;
  setEditingName: (name: string) => void;
  saveAccountName: (account: AccountRow) => Promise<void>;
  syncing: string | null;
  sync: (id: string) => Promise<void>;
  action: (id: string, body: Record<string, unknown>) => Promise<unknown>;
  refresh: () => void;
  setConfirmAction: (value: { type: "delete" | "clear"; account: AccountRow }) => void;
  onTransfer: (account: AccountRow) => void;
}) {
  const broker = brokerDetails(account.broker);
  const status = connectionStatus(account);
  const failed = account.snapshot?.syncStatus === "error";
  const isSyncing = syncing === account.id;
  const hasSnapshot = Boolean(account.snapshot?.fetchedAt || account.lastSyncAt);
  const equityCurrency = account.snapshot?.currency ?? account.currency;
  return (
    <Card
      key={account.id}
      className={`flex h-full flex-col ${account.archivedAt ? "opacity-60" : ""}`}
    >
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <CardTitle className="min-w-0 flex-1 block text-base font-semibold normal-case tracking-normal text-foreground">
          {editingNameId === account.id ? (
            <div className="flex items-center gap-1.5">
              <Input
                autoFocus
                value={editingName}
                onChange={(event) => setEditingName(event.target.value)}
                className="h-8 text-sm font-semibold"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setEditingNameId(null);
                    setEditingName("");
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void saveAccountName(account);
                  }
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Save account name"
                onClick={() => void saveAccountName(account)}
              >
                <Check />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Cancel"
                onClick={() => {
                  setEditingNameId(null);
                  setEditingName("");
                }}
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex min-w-0 flex-1 basis-48 items-center gap-1.5">
                {account.kind === "sync" && <BrokerLogo broker={account.broker} />}
                <span className="block min-w-0 flex-1 break-words">{account.name}</span>
                <AccountDragHandle />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  title="Edit account name"
                  onClick={() => {
                    setEditingNameId(account.id);
                    setEditingName(account.name);
                  }}
                >
                  <Pencil />
                </Button>
              </div>
              {account.kind === "sync" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={syncing === account.id}
                  onClick={() => void sync(account.id)}
                  title="Sync account"
                >
                  <RefreshCw className={syncing === account.id ? "animate-spin" : undefined} />
                  {syncing === account.id ? "Syncing…" : "Sync now"}
                </Button>
              )}
            </div>
          )}
          <Badge variant="secondary" className="mt-1.5 mr-2">
            {account.kind === "sync" ? "Broker" : account.kind === "manual" ? "Manual" : "Import"}
          </Badge>
          {account.broker && (
            <span className="text-xs font-normal text-muted-foreground">{broker.name}</span>
          )}
        </CardTitle>
        {editingNameId !== account.id && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title={account.archivedAt ? "Unarchive" : "Archive"}
              onClick={() =>
                void action(account.id, {
                  action: account.archivedAt ? "unarchive" : "archive",
                })
              }
            >
              {account.archivedAt ? <ArchiveRestore /> : <Archive />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="Delete account"
              onClick={() => setConfirmAction({ type: "delete", account })}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col space-y-3">
        {account.kind === "sync" && (
          <>
            <div className="grid grid-cols-2 gap-0 rounded-md bg-muted/40 sm:grid-cols-3">
              <div className="border-b border-r p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  Sync start date
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  <SyncStartDate account={account} disabled={isSyncing} refresh={refresh} />
                </div>
              </div>
              <div className="border-b p-3 sm:border-r">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock3 className="h-4 w-4" />
                  Last successful sync
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {account.lastSyncAt ? account.lastSyncAt.slice(0, 16).replace("T", " ") : "Never"}
                </div>
              </div>
              {(() => {
                const label = isSyncing
                  ? "Syncing…"
                  : status === "disconnected"
                    ? "Disconnected"
                    : failed
                      ? "Sync failed"
                      : status === "connected"
                        ? "Connected"
                        : "Not checked";
                const color = isSyncing
                  ? "bg-muted-foreground"
                  : status === "disconnected"
                    ? "bg-red-500"
                    : failed
                      ? "bg-amber-500"
                      : status === "connected"
                        ? "bg-emerald-500"
                        : "bg-muted-foreground";
                return (
                  <div className="col-span-2 border-b p-3 sm:col-span-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                      Status
                    </div>
                    <div
                      className={`mt-1 text-sm font-medium ${status === "disconnected" ? "text-loss" : "text-foreground"}`}
                      role="status"
                    >
                      {label}
                    </div>
                  </div>
                );
              })()}
              <div className="col-span-2 min-w-0 p-3 sm:col-span-3">
                <div className="text-xs text-muted-foreground">Message</div>
                <TruncatedMessage
                  message={
                    account.snapshot?.connectionMessage ??
                    account.snapshot?.syncMessage ??
                    "Sync to check this connection"
                  }
                />
              </div>
            </div>

            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer py-1 text-foreground">Connection details</summary>
              <div className="space-y-1.5 pt-2 leading-relaxed">
                <p>{broker.historyNote}</p>
                {account.broker !== "bitunix" && (
                  <p>Open orders are not provided by this connector.</p>
                )}
                {(account.snapshot?.brokerAccountCount ?? 0) > 1 && (
                  <p>
                    Account value combines {account.snapshot!.brokerAccountCount} broker accounts in{" "}
                    {equityCurrency}.
                  </p>
                )}
                {account.syncStartAt && (
                  <p>
                    The start date filters new imports; it does not extend the broker’s available
                    history.
                  </p>
                )}
              </div>
            </details>

            {(() => {
              const equity = account.snapshot?.equity;
              const initial = account.initialBalance;
              const hasEquity = typeof equity === "number" && Number.isFinite(equity);
              const hasInitial = Number.isFinite(initial) && initial > 0;
              const sameCurrency = equityCurrency === account.currency;
              const difference = hasEquity && hasInitial && sameCurrency ? equity - initial : null;
              const percentage = difference !== null ? (difference / initial) * 100 : null;
              const positive = hasEquity && equity >= initial;
              const hasDifference = difference !== null;
              return (
                <div className={`grid gap-3 sm:grid-cols-2`}>
                  <div className="rounded-md border border-border p-4">
                    {" "}
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      {account.broker === "bitunix" ? "Broker equity (Futures)" : "Broker equity"}{" "}
                      <span title="Account value reported at the last successful sync.">
                        <CircleHelp className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-semibold tracking-tight tnum">
                      <MonetaryValue>
                        {hasEquity ? fmtMoney(equity, equityCurrency) : "—"}
                      </MonetaryValue>
                      <span className="text-sm font-normal text-muted-foreground">
                        {hasSnapshot
                          ? `${account.snapshot?.positions?.length ?? 0} positions / holdings`
                          : "Positions not checked"}
                        {" · "}
                        {account.broker === "bitunix" && hasSnapshot && account.snapshot?.openOrders
                          ? `${account.snapshot.openOrders.length} open orders`
                          : "Open orders unavailable"}
                      </span>
                    </div>
                    {percentage !== null && hasDifference ? (
                      <div
                        className={`mt-1 flex items-center gap-1.5 text-sm font-medium ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-loss"}`}
                      >
                        {positive ? (
                          <ArrowUpRight className="h-4 w-4" />
                        ) : (
                          <ArrowDownRight className="h-4 w-4" />
                        )}
                        {positive ? "+" : ""}
                        {percentage.toFixed(2)}% (
                        <MonetaryValue>{fmtMoney(difference, equityCurrency)}</MonetaryValue>) since
                        initial balance
                      </div>
                    ) : (
                      <div className="mt-1 text-sm text-muted-foreground">
                        {!hasEquity
                          ? "Sync to retrieve the broker’s account value."
                          : sameCurrency
                            ? "Set an initial balance to calculate the difference."
                            : `Initial balance is in ${account.currency}; no cross-currency comparison is made.`}
                      </div>
                    )}
                    {failed && hasSnapshot && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Showing values from the last successful sync.
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border bg-muted/20 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      Initial balance{" "}
                      <span title="Independent journal starting point for drawdown calculations.">
                        <CircleHelp className="h-4 w-4 text-muted-foreground" />
                      </span>
                    </div>
                    <MonetaryField>
                      <Input
                        defaultValue={account.initialBalance || ""}
                        placeholder="0"
                        inputMode="decimal"
                        onBlur={async (event) => {
                          const value = Number(event.target.value || 0);
                          if (value !== account.initialBalance) {
                            await postJson(
                              `/api/accounts/${account.id}`,
                              { initialBalance: value },
                              "PATCH",
                            );
                            refresh();
                          }
                        }}
                        className="mt-2 bg-background"
                      />
                    </MonetaryField>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Used as the starting point for drawdown calculations.
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
        {account.kind === "manual" ? (
          <div className="flex min-h-[220px] flex-1 flex-col">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  Profit calculation{" "}
                  <span title="How TraderJourney attributes fills to exits.">
                    <CircleHelp className="h-4 w-4 text-muted-foreground" />
                  </span>
                </label>
                <Select
                  value={account.profitCalcMethod}
                  onValueChange={async (value) => {
                    await postJson(
                      `/api/accounts/${account.id}`,
                      { profitCalcMethod: value },
                      "PATCH",
                    );
                    refresh();
                  }}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fifo">FIFO</SelectItem>
                    <SelectItem value="lifo">LIFO</SelectItem>
                    <SelectItem value="wavg">Weighted average</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  Initial balance{" "}
                  <span title="Independent journal starting point for drawdown calculations.">
                    <CircleHelp className="h-4 w-4 text-muted-foreground" />
                  </span>
                </label>
                <MonetaryField>
                  <Input
                    defaultValue={account.initialBalance || ""}
                    placeholder="0"
                    inputMode="decimal"
                    onBlur={async (event) => {
                      const value = Number(event.target.value || 0);
                      if (value !== account.initialBalance) {
                        await postJson(
                          `/api/accounts/${account.id}`,
                          { initialBalance: value },
                          "PATCH",
                        );
                        refresh();
                      }
                    }}
                    className="mt-2 bg-background"
                  />
                </MonetaryField>
              </div>
            </div>
            <div className="min-h-12 flex-1" aria-hidden="true" />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction({ type: "clear", account })}
              >
                <Trash2 />
                Clear trades
              </Button>
              <Button variant="outline" size="sm" onClick={() => onTransfer(account)}>
                <Database />
                Transfer data
              </Button>
            </div>
          </div>
        ) : account.kind === "import" ? (
          <div className="flex min-h-[220px] flex-1 flex-col">
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                Profit calculation{" "}
                <span title="How TraderJourney attributes fills to exits.">
                  <CircleHelp className="h-4 w-4 text-muted-foreground" />
                </span>
              </label>
              <Select
                value={account.profitCalcMethod}
                onValueChange={async (value) => {
                  await postJson(
                    `/api/accounts/${account.id}`,
                    { profitCalcMethod: value },
                    "PATCH",
                  );
                  refresh();
                }}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fifo">FIFO</SelectItem>
                  <SelectItem value="lifo">LIFO</SelectItem>
                  <SelectItem value="wavg">Weighted average</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-h-12 flex-1" aria-hidden="true" />
            <div className="flex flex-nowrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmAction({ type: "clear", account })}
              >
                <Trash2 />
                Clear trades
              </Button>
              <Button variant="outline" size="sm" onClick={() => onTransfer(account)}>
                <Database />
                Transfer data
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-auto grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
            <div>
              <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
                Profit calculation{" "}
                <span title="How TraderJourney attributes fills to exits.">
                  <CircleHelp className="h-4 w-4 text-muted-foreground" />
                </span>
              </label>
              <Select
                value={account.profitCalcMethod}
                onValueChange={async (value) => {
                  await postJson(
                    `/api/accounts/${account.id}`,
                    { profitCalcMethod: value },
                    "PATCH",
                  );
                  refresh();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fifo">FIFO</SelectItem>
                  <SelectItem value="lifo">LIFO</SelectItem>
                  <SelectItem value="wavg">Weighted average</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="hidden h-16 w-px self-end bg-border sm:block" aria-hidden="true" />
            <div className="flex min-h-16 flex-col">
              <div className="mt-auto flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmAction({ type: "clear", account })}
                >
                  <Trash2 />
                  Clear trades
                </Button>
                <Button variant="outline" size="sm" onClick={() => onTransfer(account)}>
                  <Database />
                  Transfer data
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function TruncatedMessage({ message }: { message: string }) {
  const ref = useState<HTMLDivElement | null>(null);
  const [node, setNode] = ref;
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!node) return;
    const update = () => setTruncated(node.scrollWidth > node.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, message]);

  const content = (
    <div ref={setNode} className="mt-1 truncate text-sm font-medium text-foreground">
      {message}
    </div>
  );
  return truncated ? (
    <HoverHint content={message} side="top">
      {content}
    </HoverHint>
  ) : (
    content
  );
}

function AccountDragHandle() {
  return useContext(AccountDragHandleContext) as ReactNode;
}

export function SortableAccountShell({
  account,
  dragging,
  children,
}: {
  account: AccountRow;
  dragging: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: account.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={dragging ? "z-10 h-full opacity-75" : "h-full"}
    >
      <div className="relative h-full">
        <AccountDragHandleContext.Provider
          value={
            <Button
              ref={setActivatorNodeRef}
              type="button"
              variant="ghost"
              size="icon"
              {...attributes}
              {...listeners}
              className="h-7 w-7 shrink-0 touch-none cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
              aria-label={`Rearrange ${account.name}`}
              title="Drag to rearrange"
            >
              <GripVertical />
            </Button>
          }
        >
          {children}
        </AccountDragHandleContext.Provider>
      </div>
    </div>
  );
}
