import { and, eq } from "drizzle-orm";
import type { ImportedExecution } from "@traderjourney/importers";
import {
  accounts,
  attachments,
  db,
  executions,
  notes,
  snapshots,
  tradeRuleChecks,
  trades,
} from "@/db";
import { partitionExecutions, type InsertResult } from "./executions";
import { executionHash, newId, nowIso } from "./ids";
import { rebuildAccount } from "./rebuild";

type Metadata = Record<string, unknown>;
const metadataOf = (json: string | null): Metadata => (json ? JSON.parse(json) : {});
const annotationFields = [
  "notes",
  "tagsJson",
  "mistakesJson",
  "reasonForExitJson",
  "exitOutcome",
  "totalPossibleR",
  "volumeAfterTp",
  "priceActionJson",
  "playbookId",
  "rating",
  "stopLoss",
  "profitTarget",
  "reviewedAt",
  "tradingViewUrl",
] as const;

/** Call inside the sync transaction, so executions, journal links and cursor commit together. */
export const reconcileBitunixExecutions = (
  accountId: string,
  incoming: ImportedExecution[],
  funding: Record<string, number>,
): InsertResult & { corrected: number } => {
  if (!db.select().from(accounts).where(eq(accounts.id, accountId)).get())
    throw new Error("Account not found");
  const { usable, skipped, skippedReasons } = partitionExecutions(incoming, "sync");
  const before = db.select().from(trades).where(eq(trades.accountId, accountId)).all();
  const stored = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
  const byIdentity = new Map<string, typeof stored>();
  for (const row of stored) {
    const identity = metadataOf(row.importMetadataJson).id;
    if (row.source !== "sync" || typeof identity !== "string" || !identity.startsWith("bitunix:"))
      continue;
    const matches = byIdentity.get(identity) ?? [];
    matches.push(row);
    byIdentity.set(identity, matches);
  }
  const aliases = new Map<string, string>();
  let inserted = 0,
    corrected = 0,
    duplicates = 0;
  const seen = new Set<string>();
  for (const row of usable) {
    const identity = row.importMetadata!.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const matches = (byIdentity.get(identity) ?? []).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const existing = matches[0];
    const metadata = { ...metadataOf(existing?.importMetadataJson ?? null), ...row.importMetadata };
    if (funding[identity] !== undefined) metadata.reportedFunding = funding[identity];
    const values = {
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      price: row.price,
      fee: row.fee ?? 0,
      executedAt: row.executedAt,
      assetClass: row.assetClass ?? null,
      importMetadataJson: JSON.stringify(metadata),
      contentHash: executionHash(row),
    };
    // Only collapse proven duplicate exchange IDs, never rows absent from an API response.
    for (const duplicate of matches.slice(1)) {
      aliases.set(duplicate.id, existing!.id);
      db.delete(executions).where(eq(executions.id, duplicate.id)).run();
    }
    if (!existing) {
      db.insert(executions)
        .values({ id: newId(), accountId, source: "sync", createdAt: nowIso(), ...values })
        .run();
      inserted++;
    } else if (
      matches.length > 1 ||
      Object.entries(values).some(
        ([key, value]) => existing[key as keyof typeof existing] !== value,
      )
    ) {
      db.update(executions).set(values).where(eq(executions.id, existing.id)).run();
      corrected++;
    } else duplicates++;
  }
  if (inserted === 0 && corrected === 0)
    return { inserted, corrected, duplicates, skipped, skippedReasons };
  rebuildAccount(accountId);
  const after = db.select().from(trades).where(eq(trades.accountId, accountId)).all();
  const reviewedTargets = new Set(before.map((trade) => trade.key));
  for (const previous of before) {
    if (after.some((trade) => trade.key === previous.key)) continue;
    const ids = new Set(
      (JSON.parse(previous.executionIdsJson) as string[]).map((id) => aliases.get(id) ?? id),
    );
    const candidates = after.filter((trade) =>
      (JSON.parse(trade.executionIdsJson) as string[]).some((id) => ids.has(id)),
    );
    if (candidates.length !== 1)
      throw new Error(
        "Bitunix correction could not uniquely preserve journal data; no changes saved.",
      );
    const target = candidates[0]!;
    const annotations: Record<string, unknown> = {};
    for (const field of annotationFields) {
      const value = previous[field];
      if (value === null) continue;
      // Never silently discard conflicting reviews when historical duplicates merge.
      if (reviewedTargets.has(target.key) && target[field] !== null && target[field] !== value) {
        throw new Error("Bitunix duplicate trades have conflicting annotations; no changes saved.");
      }
      annotations[field] = value;
    }
    if (Object.keys(annotations).length > 0)
      db.update(trades).set(annotations).where(eq(trades.key, target.key)).run();
    Object.assign(target, annotations);
    reviewedTargets.add(target.key);
    db.update(tradeRuleChecks)
      .set({ tradeKey: target.key })
      .where(eq(tradeRuleChecks.tradeKey, previous.key))
      .run();
    db.update(notes).set({ tradeKey: target.key }).where(eq(notes.tradeKey, previous.key)).run();
    db.update(attachments)
      .set({ ownerId: target.key })
      .where(and(eq(attachments.ownerType, "trade"), eq(attachments.ownerId, previous.key)))
      .run();
    // The unique owner constraint rolls back the sync if two saved snapshots would collide.
    db.update(snapshots)
      .set({ ownerId: target.key })
      .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, previous.key)))
      .run();
  }
  return { inserted, corrected, duplicates, skipped, skippedReasons };
};
