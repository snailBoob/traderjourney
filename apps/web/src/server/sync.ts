import {
  connect,
  listBrokers,
  BrokerAuthError,
  MissingCredentialsError,
  type BrokerId,
  type BrokerSnapshot as SdkSnapshot,
} from "@luxalgo/broker-sdk";
import { brokerDetails, syncSummary, type BrokerConnectionStatus } from "@/lib/brokers";
import { eq, count } from "drizzle-orm";
import { accounts, db, executions } from "@/db";
import { decryptJson, encryptJson } from "./crypto";
import { nowIso } from "./ids";
import { insertExecutions, type InsertResult } from "./executions";
import { reconcileBitunixExecutions } from "./bitunix-reconcile";
import { refreshAccountExcursions } from "./excursions";
import { getImportTimeZone } from "./settings";
import { requireValue } from "./api";
import {
  assertIbkrSyncTimeZone,
  canonicalImportTimeZone,
  isIbkrSyncAccount,
} from "./ibkr-sync-timezone";
import { BitunixApiError, bitunixBrokerInfo, isBitunixCredentials, syncBitunix } from "./bitunix";
import { brokerErrorMessage } from "./broker-error";
import { brokerExecutions, hasNewSdkHistory } from "./broker-executions";
import { kucoin } from "@luxalgo/broker-sdk/adapters";
import { kucoinInstruments, retainKucoinInstruments } from "./kucoin-instruments";
import { randomUUID } from "node:crypto";
import { withLogContext } from "./log-context";
import { logInfo, logError } from "./logger";

/** Existing broker connectivity goes through @luxalgo/broker-sdk; Bitunix is isolated here as the TJ-1.1.0 test adapter. */
export { listBrokers };

export interface SyncOutcome extends InsertResult {
  message?: string;
  corrected?: number;
  accountId: string;
  equity: number | null;
  positions: number;
  openOrders: number;
  syncedAt: string;
  fetched: number;
}

export const bitunixBroker = bitunixBrokerInfo;

type BrokerSnapshot = {
  equity: number | null;
  positions: unknown[];
  openOrders: unknown[];
  fetchedAt?: string;
  bitunixCursorAt?: string | null;
  bitunixImportInitialized?: boolean;
  connectionStatus?: BrokerConnectionStatus;
  connectionMessage?: string | null;
  syncMessage?: string | null;
};

const readSnapshot = (account: typeof accounts.$inferSelect): BrokerSnapshot => {
  if (!account.snapshotJson) return { equity: null, positions: [], openOrders: [] };
  try {
    return JSON.parse(account.snapshotJson) as BrokerSnapshot;
  } catch {
    return { equity: null, positions: [], openOrders: [] };
  }
};

const isConnectionFailure = (error: unknown): boolean => {
  if (error instanceof BitunixApiError) {
    return (
      error.status === 401 ||
      error.status === 403 ||
      ["10001", "10003", "10004", "10007"].includes(error.code)
    );
  }
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout")
  );
};

const syncBitunixAccount = async (account: typeof accounts.$inferSelect): Promise<SyncOutcome> => {
  const previousSnapshot = readSnapshot(account);
  try {
    if (!account.credentialsEnc) throw new Error("Account is missing broker credentials");
    if (!account.syncStartAt) throw new Error("Bitunix sync start date is not configured.");
    const credentials = decryptJson<Record<string, string>>(account.credentialsEnc);
    if (!isBitunixCredentials(credentials)) throw new Error("Invalid API credentials");
    // `lastSyncAt` is a UI/status timestamp. The Bitunix incremental cursor is
    // stored separately in the snapshot so a previous failed/empty sync cannot
    // accidentally move the historical import window forward.
    const snapshot = account.snapshotJson
      ? (JSON.parse(account.snapshotJson) as {
          bitunixCursorAt?: string;
          bitunixImportInitialized?: boolean;
          bitunixFundingBackfillComplete?: boolean;
          bitunixFundingVersion?: number;
          bitunixReconciliationVersion?: number;
          bitunixUnresolvedPositionIds?: string[];
        })
      : null;
    const executionCount =
      db
        .select({ value: count() })
        .from(executions)
        .where(eq(executions.accountId, account.id))
        .get()?.value ?? 0;
    const hasImportedExecutions = executionCount > 0;
    const bitunixCursorAt =
      hasImportedExecutions && snapshot?.bitunixImportInitialized
        ? (snapshot.bitunixCursorAt ?? null)
        : null;
    // Version 3 also converts Bitunix cash flows to journal costs. Re-fetch
    // history to repair version 2's sign without blindly negating local data.
    // Execution reconciliation version 1 separately repairs all existing fills
    // once, including minute-truncated timestamps outside the rolling window.
    const fundingBackfill =
      snapshot?.bitunixFundingBackfillComplete !== true ||
      snapshot?.bitunixFundingVersion !== 3 ||
      snapshot?.bitunixReconciliationVersion !== 1;
    const result = await syncBitunix(
      credentials,
      account.syncStartAt,
      bitunixCursorAt,
      fundingBackfill,
      snapshot?.bitunixUnresolvedPositionIds ?? [],
    );
    const syncedAt = nowIso();
    const nextBitunixCursorAt = result.rows.length > 0 ? result.cursorAt : bitunixCursorAt;
    return db.transaction(() => {
      const current = db.select().from(accounts).where(eq(accounts.id, account.id)).get();
      requireValue(
        current && current.syncStartAt === account.syncStartAt,
        "The sync start date changed during sync. Try again.",
      );
      const inserted = reconcileBitunixExecutions(
        account.id,
        result.rows,
        result.fundingByExecutionKey,
      );
      const equityRecord = result.accounts[0];
      const available = Number(equityRecord?.available ?? 0);
      const frozen = Number(equityRecord?.frozen ?? 0);
      const margin = Number(equityRecord?.margin ?? 0);
      const crossUnrealized = Number(equityRecord?.crossUnrealizedPNL ?? 0);
      const isolationUnrealized = Number(equityRecord?.isolationUnrealizedPNL ?? 0);
      const equity = available + frozen + margin + crossUnrealized + isolationUnrealized;
      const syncMessage =
        inserted.corrected > 0
          ? `${inserted.inserted} new fills, ${inserted.corrected} corrected fills`
          : inserted.inserted > 0
            ? `${inserted.inserted} new trades imported`
            : result.rows.length > 0
              ? "No new trades"
              : "No trades returned for the selected sync period";
      db.update(accounts)
        .set({
          lastSyncAt: syncedAt,
          snapshotJson: JSON.stringify({
            equity: Number.isFinite(equity) ? equity : null,
            positions: result.positions,
            openOrders: result.openOrders,
            fetchedAt: result.fetchedAt,
            bitunixCursorAt: nextBitunixCursorAt,
            bitunixImportInitialized: nextBitunixCursorAt !== null,
            bitunixFundingBackfillComplete:
              result.fundingBackfillComplete && inserted.skipped === 0,
            bitunixFundingVersion: 3,
            bitunixReconciliationVersion:
              result.fundingBackfillComplete && inserted.skipped === 0 ? 1 : 0,
            bitunixUnresolvedPositionIds: result.unresolvedPositionIds,
            connectionStatus: "connected",
            syncStatus: "success",
            connectionMessage: null,
            syncMessage,
          }),
        })
        .where(eq(accounts.id, account.id))
        .run();
      return {
        accountId: account.id,
        ...inserted,
        equity: Number.isFinite(equity) ? equity : null,
        positions: result.positions.length,
        openOrders: result.openOrders.length,
        syncedAt,
        fetched: result.rows.length,
        message: syncMessage,
      };
    });
  } catch (error) {
    const latest = db.select().from(accounts).where(eq(accounts.id, account.id)).get();
    if (!latest || latest.syncStartAt !== account.syncStartAt) throw error;
    const message = brokerErrorMessage(error);
    const disconnected =
      isConnectionFailure(error) ||
      (error instanceof Error && error.message === "Invalid API credentials");
    db.update(accounts)
      .set({
        snapshotJson: JSON.stringify({
          ...previousSnapshot,
          connectionStatus: disconnected ? "disconnected" : "connected",
          connectionMessage: disconnected ? message : null,
          syncMessage: message,
          syncStatus: "error",
        }),
      })
      .where(eq(accounts.id, account.id))
      .run();
    throw error;
  }
};

const syncGlobal = globalThis as typeof globalThis & {
  journalAccountSyncs?: Map<string, Promise<SyncOutcome>>;
};
const activeSyncs = (syncGlobal.journalAccountSyncs ??= new Map());

export const syncAccount = (accountId: string): Promise<SyncOutcome> => {
  const broker = db
    .select({ broker: accounts.broker })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get()?.broker;
  if (broker !== "bitunix") return syncAccountLogged(accountId);
  const active = activeSyncs.get(accountId);
  if (active) return active;
  const pending = syncAccountLogged(accountId).finally(() => activeSyncs.delete(accountId));
  activeSyncs.set(accountId, pending);
  return pending;
};

const syncAccountLogged = (accountId: string): Promise<SyncOutcome> =>
  withLogContext({ syncId: randomUUID() }, async () => {
    const started = Date.now();
    logInfo("sync", "sync.started", { accountId });
    try {
      const result = await syncAccountOnce(accountId);
      const broker = db
        .select({ broker: accounts.broker })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get()?.broker;
      if (["bitunix", "binance", "kucoin", "hyperliquid"].includes(broker ?? ""))
        await refreshAccountExcursions(accountId);
      logInfo("sync", "sync.completed", {
        accountId,
        durationMs: Date.now() - started,
        outcome: "success",
        fetched: result.fetched,
        inserted: result.inserted,
        skipped: result.skipped,
        corrected: result.corrected ?? 0,
        duplicates: result.duplicates,
      });
      return result;
    } catch (error) {
      logError("sync", "sync.failed", error, {
        accountId,
        durationMs: Date.now() - started,
        outcome: "failure",
      });
      throw error;
    }
  });

const syncAccountOnce = async (accountId: string): Promise<SyncOutcome> => {
  const account = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
  if (!account) throw new Error("Account not found");
  if (account.kind !== "sync" || !account.credentialsEnc) {
    throw new Error("Account is not broker-connected");
  }

  if (account.broker === "bitunix") return syncBitunixAccount(account);

  const statementTimeZone = isIbkrSyncAccount(account)
    ? canonicalImportTimeZone(getImportTimeZone())
    : undefined;
  if (statementTimeZone !== undefined) assertIbkrSyncTimeZone(account, statementTimeZone);

  const credentials = decryptJson<Record<string, string>>(account.credentialsEnc);
  let snapshot: SdkSnapshot;
  let marketSymbols = new Map<string, string | null>();
  try {
    const connection = connect({
      broker: account.broker as BrokerId,
      credentials,
      ...(account.syncStartAt ? { historySince: account.syncStartAt } : {}),
      ...(statementTimeZone !== undefined ? { statementTimeZone } : {}),
      // Some brokers rotate tokens on every fetch (Questrade): persist or die.
      onCredentialsRotated: (next: Record<string, string>) => {
        db.update(accounts)
          .set({ credentialsEnc: encryptJson(next) })
          .where(eq(accounts.id, accountId))
          .run();
      },
    } as Parameters<typeof connect>[0]);

    if (account.broker === "kucoin") {
      const { raw } = await kucoin.fetchRaw(credentials, { fetch });
      snapshot = { broker: "kucoin", accounts: kucoin.normalize(raw), fetchedAt: nowIso() };
      marketSymbols = kucoinInstruments(raw);
    } else {
      snapshot = await connection.fetchSnapshot();
    }
  } catch (error) {
    // Read fresh state: an OAuth token may have rotated during the failed fetch.
    const current = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (current && current.broker === account.broker) {
      const message = brokerErrorMessage(error);
      const denied =
        error instanceof BrokerAuthError ||
        error instanceof MissingCredentialsError ||
        [401, 403].includes((error as { status?: number } | null)?.status ?? 0);
      db.update(accounts)
        .set({
          snapshotJson: JSON.stringify({
            ...readSnapshot(current),
            connectionStatus: denied ? "disconnected" : "unknown",
            connectionMessage: message,
            syncStatus: "error",
            syncMessage: message,
          }),
        })
        .where(eq(accounts.id, accountId))
        .run();
    }
    throw error;
  }
  const syncedAt = nowIso();

  requireValue(
    new Set(snapshot.accounts.map((a) => a.currency)).size <= 1,
    "The broker returned accounts in different currencies. A combined journal requires currency conversion or separate broker accounts; nothing was imported.",
  );
  const rows = brokerExecutions(account.broker!, snapshot);
  const timed = rows.filter(
    (row) =>
      row.executedAt !== "" &&
      (!account.syncStartAt ||
        !Number.isFinite(Date.parse(row.executedAt)) ||
        Date.parse(row.executedAt) >= Date.parse(account.syncStartAt)),
  );
  const untimed = rows.filter((row) => row.executedAt === "").length;

  const equity = snapshot.accounts.reduce((total, a) => total + a.equity, 0);
  const positions = snapshot.accounts.flatMap((a) => a.positions);
  const result = db.transaction(
    () => {
      const currentDate = db
        .select({ value: accounts.syncStartAt })
        .from(accounts)
        .where(eq(accounts.id, accountId))
        .get();
      requireValue(
        currentDate && currentDate.value === account.syncStartAt,
        "The sync start date changed during sync. Try again.",
      );
      if (statementTimeZone !== undefined) {
        const current = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
        requireValue(
          current &&
            isIbkrSyncAccount(current) &&
            current.credentialsEnc === account.credentialsEnc,
          "The IBKR connection changed during sync. Try again.",
        );
        assertIbkrSyncTimeZone(current, statementTimeZone);
      }
      // Validation, history provenance, deduplication and sync status commit together.
      const inserted = insertExecutions(accountId, timed, "sync", undefined, {
        preserveFees: hasNewSdkHistory(account.broker!),
      });
      if (account.broker === "kucoin") retainKucoinInstruments(accountId, marketSymbols);
      const message =
        brokerDetails(account.broker!).history === "unavailable"
          ? "Account values updated. Trade import is not available with this connector."
          : syncSummary({
              ...inserted,
              skipped: inserted.skipped + untimed,
              excluded: rows.length - timed.length - untimed,
            });
      db.update(accounts)
        .set({
          lastSyncAt: syncedAt,
          snapshotJson: JSON.stringify({
            equity,
            positions,
            fetchedAt: snapshot.fetchedAt,
            currency: snapshot.accounts[0]?.currency ?? null,
            brokerAccountCount: snapshot.accounts.length,
            connectionStatus: "connected",
            connectionMessage: null,
            syncStatus: "success",
            syncMessage: message,
          }),
          ...(statementTimeZone !== undefined && inserted.inserted > 0
            ? { ibkrSyncTimeZone: statementTimeZone }
            : {}),
        })
        .where(eq(accounts.id, accountId))
        .run();
      return { ...inserted, message };
    },
    { behavior: "immediate" },
  );
  if (untimed > 0) {
    result.skipped += untimed;
    if (result.skippedReasons.length < 5)
      result.skippedReasons.push(
        statementTimeZone !== undefined
          ? `${untimed} fill(s) had no usable timestamp. Check for missing or invalid dates, unsupported timezone suffixes, or ambiguous or nonexistent daylight-saving times.`
          : `${untimed} fill(s) had no usable timestamp.`,
      );
  }

  return {
    accountId,
    ...result,
    equity,
    positions: positions.length,
    openOrders: 0,
    syncedAt,
    fetched: rows.length,
  };
};
