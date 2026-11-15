import { kucoin, type KucoinRaw } from "@luxalgo/broker-sdk/adapters";
import { eq } from "drizzle-orm";
import { db, executions } from "@/db";
import { executionHash } from "./ids";

/** Retain the source pair without changing legacy execution hashes or annotation keys. */
export function kucoinInstruments(raw: KucoinRaw): Map<string, string | null> {
  const pairs = new Map<string, string | null>();
  for (const fill of raw.fills) {
    const trade = kucoin.normalize({ accounts: [], fills: [fill] })[0]?.trades[0];
    if (!trade?.executedAt || !fill.symbol) continue;
    const hash = executionHash({ ...trade, executedAt: trade.executedAt });
    const pair = /^[A-Z0-9]+-[A-Z0-9]+$/.test(fill.symbol) ? fill.symbol : null;
    pairs.set(hash, pairs.has(hash) && pairs.get(hash) !== pair ? null : pair);
  }
  return pairs;
}

export function retainKucoinInstruments(accountId: string, pairs: Map<string, string | null>) {
  for (const row of db.select().from(executions).where(eq(executions.accountId, accountId)).all()) {
    if (row.source !== "sync" || !pairs.has(row.contentHash)) continue;
    const previous = row.sourceInstrumentJson ? JSON.parse(row.sourceInstrumentJson) : undefined;
    const next = pairs.get(row.contentHash);
    // Colliding legacy hashes cannot prove an instrument, even on a subsequent sync.
    const symbol =
      previous && (previous.broker !== "kucoin" || previous.symbol !== next) ? null : next;
    db.update(executions)
      .set({ sourceInstrumentJson: JSON.stringify({ broker: "kucoin", symbol }) })
      .where(eq(executions.id, row.id))
      .run();
  }
}
