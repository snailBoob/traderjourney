"use client";

import { useSyncExternalStore } from "react";
import { publishHeaderNotice } from "./header-notice";

type SyncFailure = { summary: string; failures: { account: string; error: string }[] };
type SyncStatus = { syncing: boolean; accountId: string | null; syncFailure: SyncFailure | null };
const idle: SyncStatus = { syncing: false, accountId: null, syncFailure: null };
// Per browser tab: survives internal navigation, with one manual sync at a time.
let status = idle;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
function update(next: Partial<SyncStatus>) {
  status = { ...status, ...next };
  for (const listener of listeners) listener();
}
export function useSyncStatus() {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => idle,
  );
}
export function setSyncFailure(syncFailure: SyncFailure | null) {
  update({ syncFailure });
}
export async function runSync(operation: () => Promise<void>, accountId: string | null = null) {
  if (status.syncing) return;
  update({ syncing: true, accountId, syncFailure: null });
  try {
    await operation();
  } catch (cause) {
    const summary =
      cause instanceof Error ? cause.message : "Sync failed. Check Accounts before trying again.";
    setSyncFailure({ summary, failures: [] });
    publishHeaderNotice("Sync could not be confirmed. See the error in the dialog.");
  } finally {
    update({ syncing: false, accountId: null });
    window.dispatchEvent(new Event("tj:api-refresh"));
  }
}
