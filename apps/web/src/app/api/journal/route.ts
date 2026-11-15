import { desc, eq } from "drizzle-orm";
import { computeMetrics, dailyStats, dayKeyOf, type DayStats } from "@traderjourney/core";
import { db, attachments, journalDays, playbooks, progressChecks, progressRules } from "@/db";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades } from "@/server/trades-query";
import { progressScore, scheduledRules } from "@/lib/progress";

const list = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const durationMinutes = (
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): number | null => {
  if (!startTime || !endTime || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime))
    return null;
  const [startHour = 0, startMinute = 0] = startTime.split(":").map(Number);
  const [endHour = 0, endMinute = 0] = endTime.split(":").map(Number);
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  return minutes >= 0 ? minutes : null;
};

const compareNullable = (a: number | null, b: number | null) => {
  if (a == null && b == null) return { value: 0, nullable: true };
  if (a == null) return { value: 1, nullable: true };
  if (b == null) return { value: -1, nullable: true };
  return { value: a - b, nullable: false };
};

function streaks(days: DayStats[]) {
  let winning = 0,
    losing = 0,
    currentWinning = 0,
    currentLosing = 0;
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    if (day.netPnl > 0) {
      currentWinning += 1;
      currentLosing = 0;
    } else if (day.netPnl < 0) {
      currentLosing += 1;
      currentWinning = 0;
    } else {
      currentWinning = 0;
      currentLosing = 0;
    }
    winning = Math.max(winning, currentWinning);
    losing = Math.max(losing, currentLosing);
  }
  return { winning, losing };
}

export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  // Header editing only needs persisted dates, not trade/day statistics.
  if (url.searchParams.get("view") === "dates") {
    const rows = db
      .select({ date: journalDays.date })
      .from(journalDays)
      .orderBy(desc(journalDays.date))
      .all();
    return ok({ existingDates: rows.map((row) => row.date) });
  }
  const timeZone = getTimeZone();
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const strategyId = url.searchParams.get("playbookId");
  const symbols = list(url.searchParams.get("symbol")?.toUpperCase() ?? null);
  const status = url.searchParams.get("status");
  const dailyBias = url.searchParams.get("dailyBias");
  const routineId = url.searchParams.get("routine");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const focusDate = url.searchParams.get("focusDate");
  const sortBy = url.searchParams.get("sortBy");
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";
  const entriesParam = Number.parseInt(url.searchParams.get("entries") ?? "", 10);
  const entries = Number.isInteger(entriesParam) && entriesParam > 0 ? entriesParam : null;
  const pageSize = 50;

  const { trades } = queryTrades({});
  // Compute each closed trade's local day once rather than scanning all trades
  // again for every matching, visible and summarized day.
  const tradesByDay = new Map<string, typeof trades>();
  for (const trade of trades) {
    if (!trade.closedAt) continue;
    const date = dayKeyOf(trade.closedAt, timeZone);
    const group = tradesByDay.get(date);
    if (group) group.push(trade);
    else tradesByDay.set(date, [trade]);
  }
  const tradeDays = new Map(dailyStats(trades, timeZone).map((day) => [day.date, day]));
  const noteRows = db.select().from(journalDays).orderBy(desc(journalDays.date)).all();
  const noteDays = new Map(noteRows.map((row) => [row.date, row]));
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
  const allDates = [...new Set([...tradeDays.keys(), ...noteDays.keys()])]
    .filter((date) => (!from || date >= from) && (!to || date <= to))
    .sort((a, b) => b.localeCompare(a));

  const matchesDay = (date: string) => {
    const dayTrades = tradesByDay.get(date) ?? [];
    const note = noteDays.get(date);
    let bias: string[] = [];
    try {
      bias = JSON.parse(note?.dailyBiasPlaybooksJson ?? "[]") as string[];
    } catch {}
    if (strategyId && !dayTrades.some((trade) => trade.annotations?.playbook === strategyId))
      return false;
    if (symbols.length && !dayTrades.some((trade) => symbols.includes(trade.symbol.toUpperCase())))
      return false;
    if (status && !dayTrades.some((trade) => trade.status === status)) return false;
    if (dailyBias && !bias.includes(dailyBias)) return false;
    if (routineId && !scheduledRules(rules, date).some((rule) => rule.id === routineId))
      return false;
    return true;
  };

  const matchedDates = allDates.filter(matchesDay);
  // "Entries limit": only the most recent matching days; summaries and
  // pagination below are computed from this truncated list.
  const filteredDates = entries ? matchedDates.slice(0, entries) : matchedDates;
  const dateRows = filteredDates.map((date) => {
    const dayStats = tradeDays.get(date) ?? null;
    const row = noteDays.get(date);
    const routine = progressScore(rules, checks, date);
    const duration = durationMinutes(row?.startTime, row?.endTime);
    return { date, dayStats, routineScore: routine.score, sessionDurationMinutes: duration };
  });
  if (sortBy) {
    dateRows.sort((a, b) => {
      let result = 0;
      let compared: ReturnType<typeof compareNullable>;
      if (sortBy === "pnl")
        compared = compareNullable(a.dayStats?.netPnl ?? null, b.dayStats?.netPnl ?? null);
      else if (sortBy === "winrate")
        compared = compareNullable(
          a.dayStats ? (a.dayStats.trades ? a.dayStats.wins / a.dayStats.trades : 0) : null,
          b.dayStats ? (b.dayStats.trades ? b.dayStats.wins / b.dayStats.trades : 0) : null,
        );
      else if (sortBy === "trades")
        compared = compareNullable(a.dayStats?.trades ?? null, b.dayStats?.trades ?? null);
      else if (sortBy === "routine") compared = compareNullable(a.routineScore, b.routineScore);
      else if (sortBy === "sessionDuration")
        compared = compareNullable(a.sessionDurationMinutes, b.sessionDurationMinutes);
      else compared = { value: b.date.localeCompare(a.date), nullable: false };
      result = compared.nullable
        ? compared.value
        : sortDir === "asc"
          ? compared.value
          : -compared.value;
      if (result === 0) result = b.date.localeCompare(a.date);
      return result;
    });
  }
  const total = dateRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const focusIndex = focusDate ? dateRows.findIndex((row) => row.date === focusDate) : -1;
  const requestedPageForFocus = focusIndex >= 0 ? Math.floor(focusIndex / pageSize) + 1 : page;
  const currentPage = Math.min(requestedPageForFocus, totalPages);
  const visibleDates = dateRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const attachmentDays = new Set(
    db
      .select({ ownerId: attachments.ownerId })
      .from(attachments)
      .where(eq(attachments.ownerType, "day"))
      .all()
      .map((row) => row.ownerId),
  );

  const days = visibleDates.map(({ date, sessionDurationMinutes }) => {
    const dayTrades = tradesByDay.get(date) ?? [];
    const row = noteDays.get(date);
    let bias: string[] = [];
    try {
      bias = JSON.parse(row?.dailyBiasPlaybooksJson ?? "[]") as string[];
    } catch {}
    const routine = progressScore(rules, checks, date);
    const accordingToDailyBias = bias.length
      ? dayTrades.length
        ? dayTrades.filter(
            (trade) => trade.annotations?.playbook && bias.includes(trade.annotations.playbook),
          ).length / dayTrades.length
        : null
      : null;
    return {
      date,
      stats: tradeDays.get(date) ?? null,
      sessionDurationMinutes,
      hasNote: (row?.note ?? "") !== "",
      dailyBias: bias,
      accordingToDailyBias,
      routine: {
        completed: routine.completed,
        total: routine.total,
        score: routine.score,
        remaining: scheduledRules(rules, date)
          .filter(
            (rule) =>
              !checks.some(
                (check) => check.ruleId === rule.id && check.date === date && check.done,
              ),
          )
          .map((rule) => ({ id: rule.id, title: rule.title, stage: rule.stage })),
      },
      hasScreenshots: attachmentDays.has(date),
    };
  });

  const filteredDateSet = new Set(filteredDates);
  const periodTrades = trades.filter(
    (trade) => trade.closedAt && filteredDateSet.has(dayKeyOf(trade.closedAt, timeZone)),
  );
  const periodStats = dailyStats(periodTrades, timeZone);
  let biasMatched = 0;
  let biasEligible = 0;
  let routineCompleted = 0;
  let routineScheduled = 0;
  for (const date of filteredDates) {
    const dayTrades = tradesByDay.get(date) ?? [];
    const row = noteDays.get(date);
    let bias: string[] = [];
    try {
      bias = JSON.parse(row?.dailyBiasPlaybooksJson ?? "[]") as string[];
    } catch {}
    if (bias.length && dayTrades.length) {
      biasEligible += dayTrades.length;
      biasMatched += dayTrades.filter(
        (trade) => trade.annotations?.playbook && bias.includes(trade.annotations.playbook),
      ).length;
    }
    const score = progressScore(rules, checks, date);
    routineCompleted += score.completed;
    routineScheduled += score.total;
  }
  const periodRoutine = routineScheduled ? routineCompleted / routineScheduled : null;
  const periodBias = biasEligible ? biasMatched / biasEligible : null;
  const periodMetrics = computeMetrics(periodTrades, { timeZone });
  const periodStreaks = streaks(periodStats);
  const strategyRows = db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all();

  return ok({
    days,
    pagination: {
      page: currentPage,
      pageSize,
      total,
      totalPages,
      from: total ? (currentPage - 1) * pageSize + 1 : 0,
      to: total ? Math.min(currentPage * pageSize, total) : 0,
    },
    summary: {
      consecutiveWinningDays: periodStreaks.winning,
      consecutiveLosingDays: periodStreaks.losing,
      accordingToDailyBias: periodBias,
      routineCompletion: periodRoutine,
      netPnl: periodMetrics.netPnl,
      trades: periodMetrics.closedTrades,
      winRate: periodMetrics.winRate,
    },
    strategies: strategyRows,
    routines: rules.map((rule) => ({ id: rule.id, title: rule.title })),
    existingDates: noteRows.map((row) => row.date),
    timeZone,
  });
});
