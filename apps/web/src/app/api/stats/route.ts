import {
  readFilters,
  byDirection,
  byDuration,
  byHour,
  byMistake,
  byPlaybook,
  bySymbol,
  byTag,
  byWeekday,
  calendarMonthFromDays,
  computeEdgeScore,
  computeOverview,
  dailyCumulativeFromDays,
  dayKeyOf,
  plannedR,
} from "@traderjourney/core";
import { asc } from "drizzle-orm";
import { accounts, db, playbooks, journalDays, progressRules, progressChecks } from "@/db";
import { calendarRunningPnl } from "@/lib/calendar-insights";
import { handler, ok } from "@/server/api";
import { getTimeZone } from "@/server/settings";
import { queryTrades, type TradeFilters } from "@/server/trades-query";
import { progressScore } from "@/lib/progress";
import { effectiveCapitalBase, readCapitalBasis } from "@/lib/capital";
import { getTotalCapital } from "@/server/settings";
import { readExcursions, scheduleExcursions } from "@/server/excursions";
import { summarizeExcursions } from "@/lib/excursions";

/** The entire dashboard in one request. */
export const GET = handler(async (request: Request) => {
  const url = new URL(request.url);
  const timeZone = getTimeZone();
  const filters: TradeFilters = readFilters(url.searchParams);

  const { rows, trades } = queryTrades(filters);
  const excursions = readExcursions(rows);
  scheduleExcursions(excursions.tasks);
  const accountRows = db.select().from(accounts).orderBy(asc(accounts.createdAt)).all();
  const selected = filters.accounts
    ? accountRows.filter((a) => filters.accounts!.split(",").includes(a.id))
    : accountRows;
  const allocatedBalance = selected.reduce((total, a) => total + a.initialBalance, 0);
  const capitalBasis = readCapitalBasis(url.searchParams.get("capitalBasis"));
  const totalCapital = getTotalCapital();
  const initialBalance = effectiveCapitalBase({
    basis: capitalBasis,
    totalCapital,
    allocatedBalance,
  });

  const { metrics, days, equity } = computeOverview(trades, { timeZone, initialBalance });
  const accountCurrencies = new Map(accountRows.map((a) => [a.id, a.currency]));

  const closedTrades = trades.filter((trade) => trade.status !== "open");
  const cutReasons = new Map<string, { trades: number; slHits: number; tpHits: number }>();
  const patterns = new Map<string, { trades: number; wins: number; netPnl: number }>();
  const possibleR = new Map<
    string,
    { winningTrades: number; higherRCount: number; extraRSum: number; extraRCount: number }
  >();

  for (const trade of closedTrades) {
    const reason = trade.annotations?.reasonForExit?.[0];
    if (reason) {
      const current = cutReasons.get(reason) ?? { trades: 0, slHits: 0, tpHits: 0 };
      current.trades += 1;
      if (trade.annotations?.exitOutcome === "SL hit") current.slHits += 1;
      if (trade.annotations?.exitOutcome === "TP hit") current.tpHits += 1;
      cutReasons.set(reason, current);
    }

    const pattern = trade.annotations?.patternDuringTrade?.[0];
    if (pattern) {
      const current = patterns.get(pattern) ?? { trades: 0, wins: 0, netPnl: 0 };
      current.trades += 1;
      if (trade.status === "win") current.wins += 1;
      current.netPnl += trade.netPnl;
      patterns.set(pattern, current);
    }

    if (trade.status === "win") {
      const playbookId = trade.annotations?.playbook ?? "Unassigned";
      const current = possibleR.get(playbookId) ?? {
        winningTrades: 0,
        higherRCount: 0,
        extraRSum: 0,
        extraRCount: 0,
      };
      current.winningTrades += 1;
      if (trade.annotations?.totalPossibleR != null) {
        current.higherRCount += 1;
        const targetR = plannedR(trade);
        if (targetR != null && Number.isFinite(targetR)) {
          current.extraRSum += trade.annotations.totalPossibleR - targetR;
          current.extraRCount += 1;
        }
      }
      possibleR.set(playbookId, current);
    }
  }

  const cutReasonStats = [...cutReasons.entries()]
    .map(([key, value]) => ({
      key,
      trades: value.trades,
      slHits: value.slHits,
      tpHits: value.tpHits,
      cutJustified:
        value.slHits + value.tpHits > 0 ? value.slHits / (value.slHits + value.tpHits) : null,
    }))
    .sort((a, b) => b.trades - a.trades || a.key.localeCompare(b.key));
  const patternStats = [...patterns.entries()]
    .map(([key, value]) => ({
      key,
      trades: value.trades,
      winRate: value.trades ? value.wins / value.trades : null,
      netPnl: value.netPnl,
    }))
    .sort((a, b) => b.netPnl - a.netPnl || a.key.localeCompare(b.key));
  const possibleRStats = [...possibleR.entries()]
    .map(([playbookId, value]) => ({
      playbookId,
      winningTrades: value.winningTrades,
      higherRCount: value.higherRCount,
      higherRRate: value.winningTrades ? value.higherRCount / value.winningTrades : null,
      avgExtraR: value.extraRCount ? value.extraRSum / value.extraRCount : null,
    }))
    .sort((a, b) => (b.higherRRate ?? -1) - (a.higherRRate ?? -1));

  const biasRows = new Map(
    db
      .select()
      .from(journalDays)
      .all()
      .map((row) => [row.date, row]),
  );
  const progressRows = db
    .select()
    .from(progressRules)
    .all()
    .map((r) => ({ ...r, weekdays: JSON.parse(r.weekdaysJson) as number[] }));
  const checks = db.select().from(progressChecks).all();
  const biasPnlDays = new Map<string, { pnl: number; trades: number; wins: number }>();
  const tradeDates = new Set<string>();
  for (const trade of trades) {
    if (trade.status === "open" || !trade.closedAt) continue;
    const date = dayKeyOf(trade.closedAt, timeZone);
    tradeDates.add(date);
    const row = biasRows.get(date);
    let bias: string[] = [];
    try {
      bias = JSON.parse(row?.dailyBiasPlaybooksJson ?? "[]") as string[];
    } catch {}
    // Only include dates with a Daily Bias. A date with closed trades but no
    // Strategy match remains a zero-P&L day rather than being silently omitted.
    if (!bias.length) continue;
    const current = biasPnlDays.get(date) ?? { pnl: 0, trades: 0, wins: 0 };
    if (trade.annotations?.playbook && bias.includes(trade.annotations.playbook)) {
      current.pnl += trade.netPnl;
      current.trades += 1;
      if (trade.status === "win") current.wins += 1;
    }
    biasPnlDays.set(date, current);
  }
  const dailyBiasPnl = [...biasPnlDays.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, ...value }));

  const progressData = progressRows.map((r) => ({ ...r, weekdays: r.weekdays }));
  const dailyCompletionPnl = [...tradeDates].sort().flatMap((date) => {
    const score = progressScore(progressData, checks, date).score;
    if (score === null) return [];
    const pnl = trades
      .filter(
        (trade) =>
          trade.status !== "open" && trade.closedAt && dayKeyOf(trade.closedAt, timeZone) === date,
      )
      .reduce((sum, trade) => sum + trade.netPnl, 0);
    return [{ date, pnl, progress: score * 100 }];
  });

  const today = dayKeyOf(new Date().toISOString(), timeZone);
  const calendarYear = Number(url.searchParams.get("calYear") ?? today.slice(0, 4));
  const calendarMonthNum = Number(url.searchParams.get("calMonth") ?? today.slice(5, 7));
  const calendarPrefix = `${calendarYear}-${String(calendarMonthNum).padStart(2, "0")}`;
  const calendarTrades = trades.filter(
    (trade) =>
      trade.status !== "open" &&
      trade.closedAt &&
      dayKeyOf(trade.closedAt, timeZone).startsWith(calendarPrefix),
  );
  const calendarCurrencies = [
    ...new Set(
      calendarTrades.length
        ? calendarTrades.map((trade) => accountCurrencies.get(trade.accountId) ?? "USD")
        : selected.map((account) => account.currency),
    ),
  ];

  return ok({
    excursionsPending: excursions.pending,
    excursions: summarizeExcursions(
      rows.map((row) => ({ status: row.status, excursion: excursions.views.get(row.key)! })),
    ),
    timeZone,
    currencies: [...new Set(trades.map((t) => accountCurrencies.get(t.accountId) ?? "USD"))],
    accounts: accountRows.map((a) => ({ id: a.id, name: a.name })),
    playbooks: db.select({ id: playbooks.id, name: playbooks.name }).from(playbooks).all(),
    metrics,
    edgeScore: computeEdgeScore(metrics),
    days,
    dailyCumulative: dailyCumulativeFromDays(days),
    equity,
    calendar: calendarMonthFromDays(days, calendarYear, calendarMonthNum),
    calendarCurrencies,
    runningPnl: calendarCurrencies.length <= 1 ? calendarRunningPnl(calendarTrades, timeZone) : {},
    dailyBiasPnl,
    dailyCompletionPnl,
    overviewAnalysis: {
      cutReasons: cutReasonStats,
      possibleR: possibleRStats,
      patterns: patternStats,
    },
    buckets: {
      symbol: bySymbol(trades).slice(0, 20),
      tag: byTag(trades),
      mistake: byMistake(trades),
      playbook: byPlaybook(trades),
      weekday: byWeekday(trades, timeZone),
      hour: byHour(trades, timeZone),
      duration: byDuration(trades),
      direction: byDirection(trades),
    },
    openPositions: trades
      .filter((t) => t.status === "open")
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        direction: t.direction,
        openedAt: t.openedAt,
        quantity: t.openQuantity,
        avgEntry: t.avgEntry,
      })),
    recentTrades: [...trades]
      .filter((t) => t.status !== "open")
      .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""))
      .slice(0, 10)
      .map((t) => ({
        key: t.key,
        symbol: t.symbol,
        closedAt: t.closedAt,
        netPnl: t.netPnl,
        status: t.status,
      })),
    initialBalance,
    capitalBasis,
    totalCapital,
    allocatedBalance,
  });
});
