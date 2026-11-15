"use client";

import { AccountConfirmationDialog, AccountTransferDialog } from "./account-action-dialogs";
import { AccountCard, SortableAccountShell } from "./account-card";
import { AddAccountDialog } from "./add-account-dialog";
import { CapitalCard } from "./capital-card";
import type { AccountRow } from "./types";

import { FilterBar } from "@/components/filter-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveUiPreference, useUiPreferences } from "@/lib/ui-preferences-client";
import { postJson, useApi } from "@/lib/use-api";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { Suspense, useEffect, useState } from "react";

export default function AccountsPage() {
  return (
    <Suspense>
      <Accounts />
    </Suspense>
  );
}

function Accounts() {
  const { data, refresh } = useApi<{ accounts: AccountRow[] }>("/api/accounts");
  const { data: uiSettings } = useUiPreferences();
  const [orderedAccounts, setOrderedAccounts] = useState<AccountRow[]>([]);
  const [draggingAccountId, setDraggingAccountId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [syncing, setSyncing] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmAction, setConfirmAction] = useState<{
    type: "delete" | "clear";
    account: AccountRow;
  } | null>(null);
  const [transferSource, setTransferSource] = useState<AccountRow | null>(null);
  const [transferTarget, setTransferTarget] = useState("");
  const [message, setMessage] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    if (!data || !uiSettings) return;
    const saved = uiSettings.preferences.accountOrder;
    const savedIds = Array.isArray(saved)
      ? saved.filter((id): id is string => typeof id === "string")
      : [];
    const byId = new Map(data.accounts.map((account) => [account.id, account]));
    setOrderedAccounts((current) => {
      if (current.length === 0) {
        return [
          ...savedIds
            .map((id) => byId.get(id))
            .filter((account): account is AccountRow => Boolean(account)),
          ...data.accounts.filter((account) => !savedIds.includes(account.id)),
        ];
      }
      const currentIds = new Set(current.map((account) => account.id));
      const preserved = current
        .map((account) => byId.get(account.id))
        .filter((account): account is AccountRow => Boolean(account));
      const added = data.accounts.filter((account) => !currentIds.has(account.id));
      return [...preserved, ...added];
    });
  }, [data, uiSettings]);

  const handleAccountDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingAccountId(null);
    if (!over || active.id === over.id) return;
    const from = orderedAccounts.findIndex((account) => account.id === String(active.id));
    const to = orderedAccounts.findIndex((account) => account.id === String(over.id));
    if (from < 0 || to < 0 || from === to) return;
    const next = [...orderedAccounts];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setOrderedAccounts(next);
    void saveUiPreference(
      "accountOrder",
      next.map((account) => account.id),
    );
  };

  const action = async <T = unknown,>(id: string, body: Record<string, unknown>) => {
    const result = await postJson<T>(`/api/accounts/${id}/actions`, body);
    refresh();
    return result;
  };

  const sync = async (id: string) => {
    setSyncing(id);
    try {
      await action<{
        sync: {
          inserted: number;
          fetched: number;
          duplicates: number;
          skipped: number;
          skippedReasons: string[];
        };
      }>(id, { action: "sync" });
    } catch (error) {
      refresh();
      setMessage({
        title: "Sync failed",
        body: error instanceof Error ? error.message : "Sync failed",
      });
    } finally {
      setSyncing(null);
    }
  };

  const saveAccountName = async (account: AccountRow) => {
    const name = editingName.trim();
    if (!name) return;
    if (name === account.name) {
      setEditingNameId(null);
      setEditingName("");
      return;
    }
    try {
      await postJson(`/api/accounts/${account.id}`, { name }, "PATCH");
      refresh();
      setEditingNameId(null);
      setEditingName("");
    } catch (error) {
      setMessage({
        title: "Could not rename account",
        body: error instanceof Error ? error.message : "Could not rename account",
      });
    }
  };

  const openTransfer = (account: AccountRow) => {
    const others = (data?.accounts ?? []).filter((candidate) => candidate.id !== account.id);
    if (others.length === 0) {
      setMessage({
        title: "Transfer data",
        body: "No other account is available to transfer into.",
      });
      return;
    }
    const target = others[0];
    if (!target) {
      setMessage({
        title: "Transfer data",
        body: "No other account is available to transfer into.",
      });
      return;
    }
    setTransferTarget(target.id);
    setTransferSource(account);
  };

  return (
    <div>
      <AccountConfirmationDialog
        confirmAction={confirmAction}
        setConfirmAction={setConfirmAction}
        action={action}
        refresh={refresh}
        setMessage={setMessage}
      />
      <AccountTransferDialog
        transferSource={transferSource}
        setTransferSource={setTransferSource}
        transferTarget={transferTarget}
        setTransferTarget={setTransferTarget}
        data={data}
        action={action}
        setMessage={setMessage}
      />
      <Dialog open={message !== null} onOpenChange={(open) => !open && setMessage(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{message?.title}</DialogTitle>
            <DialogDescription>{message?.body}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end">
            <Button type="button" onClick={() => setMessage(null)}>
              OK
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <FilterBar
        title="Accounts"
        showHeaderMessage={false}
        actions={<AddAccountDialog refresh={refresh} setMessage={setMessage} />}
      />
      <CapitalCard accounts={(data?.accounts ?? []).filter((account) => !account.archivedAt)} />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setDraggingAccountId(String(active.id))}
        onDragCancel={() => setDraggingAccountId(null)}
        onDragEnd={handleAccountDragEnd}
      >
        <SortableContext
          items={orderedAccounts.map((account) => account.id)}
          strategy={rectSortingStrategy}
        >
          <div className="grid items-stretch gap-3 p-4 min-[1440px]:grid-cols-2">
            {orderedAccounts.length === 0 && data?.accounts.length === 0 && (
              <p className="col-span-full py-16 text-center text-sm text-muted-foreground">
                No accounts yet — use Add account to create one.
              </p>
            )}
            {orderedAccounts.map((account) => (
              <SortableAccountShell
                key={account.id}
                account={account}
                dragging={draggingAccountId === account.id}
              >
                <AccountCard
                  account={account}
                  editingNameId={editingNameId}
                  editingName={editingName}
                  setEditingNameId={setEditingNameId}
                  setEditingName={setEditingName}
                  saveAccountName={saveAccountName}
                  syncing={syncing}
                  sync={sync}
                  action={action}
                  refresh={refresh}
                  setConfirmAction={setConfirmAction}
                  onTransfer={openTransfer}
                />
              </SortableAccountShell>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
