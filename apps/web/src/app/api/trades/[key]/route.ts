import { NextResponse } from "next/server";
import { tradeRisk, tradeR, plannedR } from "@traderjourney/core";
import { and, eq } from "drizzle-orm";
import { db, trades, playbooks, accounts, snapshots, attachments } from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { deleteExecutionsForTrades, listExecutions } from "@/server/executions";
import { newId, nowIso } from "@/server/ids";
import { getTradeByKey, rowToTrade } from "@/server/trades-query";
import { getTimeZone } from "@/server/settings";
import { fetchTradingViewSnapshot, validTradingViewUrl } from "@/lib/tradingview-snapshot";
import { readExcursions, processExcursions } from "@/server/excursions";
import { recognizePositionLevels } from "@/server/position-levels";

type Params = { params: Promise<{ key: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  const trade = rowToTrade(row);
  const fills = listExecutions(row.accountId, trade.executionIds);
  const snapshot = db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, key)))
    .get();
  return ok({
    timeZone: getTimeZone(),
    trade: {
      ...row,
      hasSnapshot: Boolean(snapshot),
      snapshotId: snapshot?.id ?? null,
      status: trade.status,
      riskAmount: tradeRisk(trade),
      realizedR: tradeR(trade),
      plannedR: plannedR(trade),
      contractMultiplier: trade.contractMultiplier ?? null,
      currency:
        db
          .select({ currency: accounts.currency })
          .from(accounts)
          .where(eq(accounts.id, row.accountId))
          .get()?.currency ?? "USD",
    },
    executions: fills,
  });
});

interface AnnotateBody {
  notes?: string | null;
  tags?: string[];
  mistakes?: string[];
  reasonForExit?: string[];
  exitOutcome?: "SL hit" | "TP hit" | null;
  totalPossibleR?: number | null;
  volumeAfterTp?: "Up" | "Down" | "Flat" | null;
  patternDuringTrade?: string[];
  playbookId?: string | null;
  rating?: number | null;
  stopLoss?: number | null;
  profitTarget?: number | null;
  reviewed?: boolean;
  tradingViewUrl?: string | null;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { key } = await params;
  const decoded = key;
  const row = getTradeByKey(decoded);
  if (!row) return bad("Trade not found", 404);

  const body = (await request.json()) as AnnotateBody;
  if (body.tradingViewUrl !== undefined) {
    requireValue(
      body.tradingViewUrl === null ||
        body.tradingViewUrl === "" ||
        validTradingViewUrl(body.tradingViewUrl),
      "Enter a valid TradingView snapshot URL.",
    );
  }
  for (const field of ["stopLoss", "profitTarget", "rating"] as const)
    requireValue(
      body[field] == null || (typeof body[field] === "number" && Number.isFinite(body[field])),
      `Invalid ${field}.`,
    );
  requireValue(
    body.rating == null || (Number.isInteger(body.rating) && body.rating >= 1 && body.rating <= 5),
    "Rating must be 1–5.",
  );
  requireValue(
    body.notes == null || (typeof body.notes === "string" && body.notes.length <= 100000),
    "Notes must be at most 100,000 characters.",
  );
  for (const field of ["tags", "mistakes"] as const)
    requireValue(
      body[field] === undefined ||
        (Array.isArray(body[field]) &&
          body[field]!.length <= 100 &&
          body[field]!.every((s) => typeof s === "string" && s.length <= 200)),
      `Invalid ${field}.`,
    );
  for (const field of ["reasonForExit", "patternDuringTrade"] as const)
    requireValue(
      body[field] === undefined ||
        (Array.isArray(body[field]) &&
          body[field]!.length <= 100 &&
          body[field]!.every((s) => typeof s === "string" && s.length <= 200)),
      `Invalid ${field}.`,
    );
  requireValue(
    body.exitOutcome === undefined ||
      body.exitOutcome === null ||
      body.exitOutcome === "SL hit" ||
      body.exitOutcome === "TP hit",
    "Exit outcome must be SL hit or TP hit.",
  );
  requireValue(
    body.totalPossibleR == null ||
      (typeof body.totalPossibleR === "number" && Number.isFinite(body.totalPossibleR)),
    "Total possible R must be a finite number.",
  );
  requireValue(
    body.volumeAfterTp === undefined ||
      body.volumeAfterTp === null ||
      body.volumeAfterTp === "Up" ||
      body.volumeAfterTp === "Down" ||
      body.volumeAfterTp === "Flat",
    "Volume after TP must be Up, Down, or Flat.",
  );
  requireValue(
    !body.playbookId || db.select().from(playbooks).where(eq(playbooks.id, body.playbookId)).get(),
    "Playbook not found.",
  );
  const patch: Partial<typeof trades.$inferInsert> = {};
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.tags !== undefined) patch.tagsJson = JSON.stringify(body.tags);
  if (body.mistakes !== undefined) patch.mistakesJson = JSON.stringify(body.mistakes);
  if (body.reasonForExit !== undefined)
    patch.reasonForExitJson = JSON.stringify(body.reasonForExit);
  if (body.exitOutcome !== undefined)
    patch.exitOutcome =
      body.reasonForExit !== undefined && body.reasonForExit.length === 0 ? null : body.exitOutcome;
  if (body.totalPossibleR !== undefined) {
    patch.totalPossibleR = body.totalPossibleR;
    if (body.totalPossibleR == null || body.totalPossibleR <= 0) patch.volumeAfterTp = null;
  }
  if (
    body.volumeAfterTp !== undefined &&
    body.totalPossibleR !== undefined &&
    body.totalPossibleR !== null &&
    body.totalPossibleR > 0
  )
    patch.volumeAfterTp = body.volumeAfterTp;
  if (body.patternDuringTrade !== undefined)
    patch.priceActionJson = JSON.stringify(body.patternDuringTrade);
  if (body.playbookId !== undefined) patch.playbookId = body.playbookId;
  if (body.rating !== undefined) patch.rating = body.rating;
  if (body.stopLoss !== undefined) patch.stopLoss = body.stopLoss;
  if (body.profitTarget !== undefined) patch.profitTarget = body.profitTarget;
  if (body.reviewed !== undefined) patch.reviewedAt = body.reviewed ? nowIso() : null;
  let snapshotUrl: string | null | undefined;
  let replaceSnapshot = false;
  if (body.tradingViewUrl !== undefined) {
    snapshotUrl = body.tradingViewUrl?.trim() || null;
    patch.tradingViewUrl = snapshotUrl;
    const existingSnapshot = db
      .select({ id: snapshots.id })
      .from(snapshots)
      .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, decoded)))
      .all();
    replaceSnapshot =
      Boolean(snapshotUrl) &&
      (snapshotUrl !== (row.tradingViewUrl ?? "") || existingSnapshot.length === 0);
  }

  if (!Object.keys(patch).length && body.tradingViewUrl === undefined) return ok({ updated: true });

  // Match Missed Trades exactly: retrieve a replacement snapshot before any
  // database mutation. A retrieval failure aborts the request, leaving the
  // existing trade, URL, annotations, and snapshot unchanged.
  let snapshotToSave: { bytes: Buffer; mime: string } | null = null;
  if (body.tradingViewUrl !== undefined && snapshotUrl && replaceSnapshot) {
    snapshotToSave = await fetchTradingViewSnapshot(snapshotUrl);
  }

  const levelFields = ["stopLoss", "profitTarget"] as const;
  const levelImage =
    snapshotUrl && levelFields.some((key) => (body[key] ?? row[key]) == null)
      ? (snapshotToSave?.bytes ??
        db
          .select({ data: snapshots.data })
          .from(snapshots)
          .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, decoded)))
          .get()?.data)
      : undefined;
  const recognized = levelImage ? await recognizePositionLevels(levelImage) : {};
  let filledStop = false;
  db.transaction((tx) => {
    if (snapshotUrl) {
      // Re-read after the download/OCR: an intervening manual edit wins.
      const current = tx
        .select({ stopLoss: trades.stopLoss, profitTarget: trades.profitTarget })
        .from(trades)
        .where(eq(trades.key, decoded))
        .get();
      for (const key of levelFields) {
        if (body[key] != null) continue;
        if (current?.[key] != null) delete patch[key];
        else if (recognized[key] != null) {
          patch[key] = recognized[key];
          if (key === "stopLoss") filledStop = true;
        }
      }
    }
    if (Object.keys(patch).length)
      tx.update(trades).set(patch).where(eq(trades.key, decoded)).run();
    if (body.tradingViewUrl !== undefined && (!snapshotUrl || replaceSnapshot)) {
      tx.delete(snapshots)
        .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, decoded)))
        .run();
      tx.delete(attachments)
        .where(and(eq(attachments.ownerType, "trade"), eq(attachments.ownerId, decoded)))
        .run();
    }
    if (snapshotToSave) {
      tx.insert(snapshots)
        .values({
          id: newId(),
          ownerType: "trade",
          ownerId: decoded,
          mime: snapshotToSave.mime,
          size: snapshotToSave.bytes.length,
          data: snapshotToSave.bytes,
          createdAt: nowIso(),
        })
        .run();
    }
  });
  const storedSnapshot =
    body.tradingViewUrl === undefined
      ? undefined
      : db
          .select({ id: snapshots.id })
          .from(snapshots)
          .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, decoded)))
          .get();
  if (body.stopLoss !== undefined || filledStop) {
    const current = getTradeByKey(decoded);
    if (current) await processExcursions(readExcursions([current]).tasks);
  }
  return ok({
    updated: true,
    snapshotSaved: body.tradingViewUrl === undefined ? undefined : Boolean(storedSnapshot),
  });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { key } = await params;
  const row = getTradeByKey(key);
  if (!row) return bad("Trade not found", 404);
  // Deleting a trade means deleting its executions; the rebuild removes the row.
  deleteExecutionsForTrades(row.accountId, JSON.parse(row.executionIdsJson) as string[]);
  db.delete(snapshots)
    .where(and(eq(snapshots.ownerType, "trade"), eq(snapshots.ownerId, key)))
    .run();
  return ok({ deleted: true });
});
