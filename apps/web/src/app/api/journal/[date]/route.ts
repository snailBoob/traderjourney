import { and, eq } from "drizzle-orm";
import { computeMetrics, dayKeyOf, intradayCurve, plannedR, tradeR } from "@traderjourney/core";
import {
  db,
  accounts,
  attachments,
  executions,
  journalDays,
  playbooks,
  progressChecks,
  progressRules,
  snapshots,
} from "@/db";
import { bad, handler, ok, requireValue } from "@/server/api";
import { nowIso } from "@/server/ids";
import { getTimeZone } from "@/server/settings";
import { queryTrades, rowToTrade } from "@/server/trades-query";
import { progressScore, scheduledRules } from "@/lib/progress";
import { readExcursions, scheduleExcursions } from "@/server/excursions";

type Params = { params: Promise<{ date: string }> };
const validDate = (date: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`));

function routineData(date: string) {
  const rules = db
    .select()
    .from(progressRules)
    .all()
    .map((row) => ({
      id: row.id,
      title: row.title,
      stage: row.stage,
      weekdays: JSON.parse(row.weekdaysJson) as number[],
      createdAt: row.createdAt,
      archivedAt: row.archivedAt,
      sortOrder: row.sortOrder,
    }));
  const checks = db
    .select()
    .from(progressChecks)
    .all()
    .map((row) => ({ ruleId: row.ruleId, date: row.date, done: row.done }));
  const scheduled = scheduledRules(rules, date).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
  );
  const score = progressScore(rules, checks, date);
  return {
    completed: score.completed,
    total: score.total,
    score: score.score,
    routines: scheduled.map((rule) => ({
      id: rule.id,
      title: rule.title,
      stage: rule.stage,
      done: checks.some((check) => check.ruleId === rule.id && check.date === date && check.done),
    })),
  };
}

export const GET = handler(async (request: Request, { params }: Params) => {
  const { date } = await params;
  if (!validDate(date)) return bad("date must be YYYY-MM-DD");
  const timeZone = getTimeZone();
  const { rows, trades } = queryTrades({});
  const dayTradeIndexes = trades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === date);
  const dayTrades = dayTradeIndexes.map(({ trade }) => trade);
  const excursions = readExcursions(dayTradeIndexes.map(({ index }) => rows[index]!));
  scheduleExcursions(excursions.tasks);
  const times = new Map<string, string>();
  for (const accountId of new Set(trades.map((trade) => trade.accountId))) {
    const fills = db.select().from(executions).where(eq(executions.accountId, accountId)).all();
    for (const fill of fills) times.set(fill.id, fill.executedAt);
  }
  const note = db.select().from(journalDays).where(eq(journalDays.date, date)).get();
  let dailyBiasPlaybooks: string[] = [];
  try {
    dailyBiasPlaybooks = JSON.parse(note?.dailyBiasPlaybooksJson ?? "[]") as string[];
  } catch {}
  const books = db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all();
  const accountNames = new Map(
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .all()
      .map((a) => [a.id, a.name]),
  );
  const snapshotOwners = new Set(
    db
      .select({ ownerId: snapshots.ownerId })
      .from(snapshots)
      .where(eq(snapshots.ownerType, "trade"))
      .all()
      .map((snapshot) => snapshot.ownerId),
  );
  const matchedBiasTrades = dailyBiasPlaybooks.length
    ? dayTrades.filter(
        (trade) =>
          trade.annotations?.playbook && dailyBiasPlaybooks.includes(trade.annotations.playbook),
      )
    : [];
  const matchedBiasKeys = new Set(matchedBiasTrades.map((trade) => trade.key));
  const matchedBiasPnl = matchedBiasTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const notMatchedBiasTrades = dailyBiasPlaybooks.length
    ? dayTrades.filter((trade) => !matchedBiasKeys.has(trade.key))
    : [];
  const notMatchedBiasPnl = notMatchedBiasTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const dayRows = dayTradeIndexes.map(({ trade, index }) => {
    const row = rows[index]!;
    const multiplier = rowToTrade(row).contractMultiplier;
    const entryNotional = row.avgEntry * row.quantity * (multiplier ?? 1);
    return {
      key: row.key,
      excursion: excursions.views.get(row.key),
      closedAt: row.closedAt ?? null,
      executionCount: (() => {
        try {
          return (JSON.parse(row.executionIdsJson ?? "[]") as unknown[]).length;
        } catch {
          return 0;
        }
      })(),
      hasSnapshot: snapshotOwners.has(row.key),
      tags: trade.annotations?.tags ?? [],
      rating: row.rating ?? null,
      reviewed: row.reviewedAt !== null,
      symbol: row.symbol,
      direction: row.direction,
      account: accountNames.get(row.accountId) ?? row.accountId,
      status: trade.status,
      netPnl: row.netPnl,
      grossPnl: row.grossPnl,
      fees: row.fees,
      volume: row.quantity,
      avgEntry: row.avgEntry,
      avgExit: row.avgExit ?? null,
      durationMs: row.durationMs ?? null,
      netEntryNotional: entryNotional > 0 ? row.netPnl / Math.abs(entryNotional) : null,
      plannedR: plannedR(trade),
      realizedR: tradeR(trade),
      totalPossibleR: row.totalPossibleR ?? null,
    };
  });
  const attachmentsRows = db
    .select({
      id: attachments.id,
      name: attachments.name,
      mime: attachments.mime,
      size: attachments.size,
    })
    .from(attachments)
    .where(and(eq(attachments.ownerType, "day"), eq(attachments.ownerId, date)))
    .all();
  return ok({
    date,
    excursionsPending: excursions.pending,
    exists: Boolean(note),
    startTime: note?.startTime ?? "",
    endTime: note?.endTime ?? "",
    sessionDurationMinutes: (() => {
      const start = note?.startTime;
      const end = note?.endTime;
      if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
      const [sh = 0, sm = 0] = start.split(":").map(Number);
      const [eh = 0, em = 0] = end.split(":").map(Number);
      const minutes = eh * 60 + em - (sh * 60 + sm);
      return sh <= 23 && eh <= 23 && sm <= 59 && em <= 59 && minutes >= 0 ? minutes : null;
    })(),
    hasAutomaticData: dayTrades.length > 0,
    metrics: computeMetrics(dayTrades, { timeZone }),
    trades: dayRows,
    intraday: intradayCurve(trades, times, date, timeZone, note?.startTime ?? ""),
    note: note?.note ?? "",
    dailyBiasPlaybooks,
    playbooks: books,
    accordingToDailyBias: dailyBiasPlaybooks.length
      ? dayTrades.length
        ? matchedBiasTrades.length / dayTrades.length
        : null
      : null,
    dailyBiasStats: dailyBiasPlaybooks.length
      ? {
          matchedTrades: matchedBiasTrades.length,
          totalTrades: dayTrades.length,
          matchedPnl: matchedBiasPnl,
          notMatchedTrades: notMatchedBiasTrades.length,
          notMatchedPnl: notMatchedBiasPnl,
        }
      : null,
    routine: routineData(date),
    attachments: attachmentsRows,
  });
});

export const PUT = handler(async (request: Request, { params }: Params) => {
  const { date } = await params;
  if (!validDate(date)) return bad("date must be YYYY-MM-DD");
  const body = (await request.json()) as {
    note?: unknown;
    dailyBiasPlaybooks?: unknown;
    startTime?: unknown;
    endTime?: unknown;
  };
  const existing = db.select().from(journalDays).where(eq(journalDays.date, date)).get();
  const knownIds = new Set(
    db
      .select({ id: playbooks.id })
      .from(playbooks)
      .all()
      .map((book) => book.id),
  );
  if (body.note !== undefined) requireValue(typeof body.note === "string", "Invalid note.");
  if (body.dailyBiasPlaybooks !== undefined) {
    requireValue(
      Array.isArray(body.dailyBiasPlaybooks) &&
        body.dailyBiasPlaybooks.every((v) => typeof v === "string"),
      "Invalid daily bias strategies.",
    );
  }
  if (body.startTime !== undefined)
    requireValue(
      body.startTime === "" ||
        (typeof body.startTime === "string" && /^\d{2}:\d{2}$/.test(body.startTime)),
      "Invalid start time.",
    );
  if (body.endTime !== undefined)
    requireValue(
      body.endTime === "" ||
        (typeof body.endTime === "string" && /^\d{2}:\d{2}$/.test(body.endTime)),
      "Invalid end time.",
    );
  const nextStartTime =
    body.startTime !== undefined ? (body.startTime as string) : (existing?.startTime ?? "");
  const nextEndTime =
    body.endTime !== undefined ? (body.endTime as string) : (existing?.endTime ?? "");
  if (nextStartTime && nextEndTime) {
    const [sh = 0, sm = 0] = nextStartTime.split(":").map(Number);
    const [eh = 0, em = 0] = nextEndTime.split(":").map(Number);
    requireValue(
      sh <= 23 && eh <= 23 && sm <= 59 && em <= 59 && eh * 60 + em >= sh * 60 + sm,
      "End time must be the same as or later than start time.",
    );
  }
  const bias =
    body.dailyBiasPlaybooks !== undefined
      ? [...new Set(body.dailyBiasPlaybooks as string[])]
      : (() => {
          try {
            return JSON.parse(existing?.dailyBiasPlaybooksJson ?? "[]") as string[];
          } catch {
            return [];
          }
        })();
  if (bias.some((id) => !knownIds.has(id)))
    return bad("A selected daily bias strategy does not exist.");
  db.insert(journalDays)
    .values({
      date,
      note: typeof body.note === "string" ? body.note : (existing?.note ?? ""),
      dailyBiasPlaybooksJson: JSON.stringify(bias),
      startTime: nextStartTime || null,
      endTime: nextEndTime || null,
      updatedAt: nowIso(),
    })
    .onConflictDoUpdate({
      target: journalDays.date,
      set: {
        note: typeof body.note === "string" ? body.note : (existing?.note ?? ""),
        dailyBiasPlaybooksJson: JSON.stringify(bias),
        startTime: nextStartTime || null,
        endTime: nextEndTime || null,
        updatedAt: nowIso(),
      },
    })
    .run();
  return ok({ saved: true });
});

export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { date } = await params;
  if (!validDate(date)) return bad("date must be YYYY-MM-DD");
  const body = (await request.json()) as { mode?: string };
  requireValue(body.mode === "delete" || body.mode === "reset", "Invalid Journal action.");
  const { trades } = queryTrades({});
  const timeZone = getTimeZone();
  const hasAutomaticData = trades.some(
    (trade) => trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === date,
  );
  const existing = db.select().from(journalDays).where(eq(journalDays.date, date)).get();
  requireValue(existing, "Journal day not found.");
  if (body.mode === "delete")
    requireValue(
      !hasAutomaticData,
      "This Journal day has automatic trade data. Use Reset instead.",
    );
  db.transaction(() => {
    db.delete(attachments)
      .where(and(eq(attachments.ownerType, "day"), eq(attachments.ownerId, date)))
      .run();
    db.delete(progressChecks).where(eq(progressChecks.date, date)).run();
    if (body.mode === "delete") db.delete(journalDays).where(eq(journalDays.date, date)).run();
    else
      db.update(journalDays)
        .set({
          note: "",
          dailyBiasPlaybooksJson: "[]",
          startTime: null,
          endTime: null,
          updatedAt: nowIso(),
        })
        .where(eq(journalDays.date, date))
        .run();
  });
  return ok({ saved: true });
});
