import { createHash } from "node:crypto";
import {
  analyzeGroups,
  computeMetrics,
  dayKeyOf,
  summarizeGroup,
  tradeR,
  type AnalysisFilters,
  type AnnotatedTrade,
} from "@traderjourney/core";
import {
  db,
  accounts,
  journalDays,
  notes,
  playbooks,
  progressRules,
  progressChecks,
  tradeRuleChecks,
} from "@/db";
import { scheduledRules } from "@/lib/progress";
import type { ReviewContext, ReviewPeriod, ReviewSource } from "@/lib/ai-review";
import { describeFilters } from "@/lib/filter-description";
import { getTimeZone } from "./settings";
import { newestClosed, queryTrades, tradeCount } from "./trades-query";
import { requireValue } from "./api";

const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);

export function buildReview(
  filters: AnalysisFilters,
  selectedNotes?: string[],
  compare = false,
): ReviewContext {
  const timeZone = getTimeZone();
  const rangeEnd =
    filters.to ?? (filters.from ? dayKeyOf(new Date().toISOString(), timeZone) : undefined);
  const accountRows = db.select().from(accounts).all();
  const strategies = db.select().from(playbooks).all();
  const strategyNames = new Map(strategies.map((p) => [p.id, p.name]));
  const currencies = new Map(accountRows.map((a) => [a.id, a.currency]));
  const count = tradeCount(filters.lastTrades);
  const all = queryTrades({ ...filters, lastTrades: undefined });
  const closed = all.trades.filter((t) => t.status !== "open" && t.closedAt).sort(newestClosed);
  const current = count ? closed.slice(0, count) : closed;
  let previous: AnnotatedTrade[] = [];
  let comparison = "No previous period: select a bounded date range or latest trade count.";
  let previousBounds: { from: string; to: string } | undefined;
  if (compare && count) {
    previous = closed.slice(count, count * 2);
    comparison = `Previous ${count} closed trades, with the same account and other filters. Fewer may be available.`;
  } else if (compare && filters.from && rangeEnd) {
    const days = Math.round((Date.parse(rangeEnd) - Date.parse(filters.from)) / 86400000) + 1;
    previousBounds = { from: shiftDay(filters.from, -days), to: shiftDay(filters.from, -1) };
    previous = queryTrades({ ...filters, ...previousBounds })
      .trades.filter((t) => t.status !== "open" && t.closedAt)
      .sort(newestClosed);
    comparison = `Previous ${days} calendar days, with the same account and other filters.`;
  }
  const period = (
    items: AnnotatedTrade[],
    bounds?: { from?: string; to?: string },
  ): ReviewPeriod => {
    const days = items.map((t) => dayKeyOf(t.closedAt!, timeZone)).sort();
    const cs = [...new Set(items.map((t) => currencies.get(t.accountId) ?? "USD"))];
    const m = computeMetrics(items, { timeZone });
    const group = summarizeGroup(items);
    return {
      count: items.length,
      from: bounds?.from ?? days[0] ?? null,
      to: bounds?.to ?? days.at(-1) ?? null,
      currencies: cs,
      metrics:
        cs.length <= 1
          ? {
              netPnl: m.netPnl,
              winRate: m.winRate,
              avgWin: m.avgWin,
              avgLoss: m.avgLoss,
              expectancy: items.length ? m.netPnl / items.length : null,
              profitFactor: m.profitFactor,
              noLosses: m.profitFactorIsInfinite,
              avgRealizedR: group.avgRealizedR,
              rCount: items.filter((t) => tradeR(t) !== null).length,
            }
          : null,
    };
  };
  const currentPeriod = period(current, count ? undefined : { ...filters, to: rangeEnd });
  const previousPeriod = period(previous, previousBounds);
  const sources: ReviewSource[] = [];
  const add = (id: string, title: string, data: unknown, href = "") =>
    sources.push({ id, title, text: typeof data === "string" ? data : JSON.stringify(data), href });
  add("current", "Current selection", currentPeriod);
  if (compare) add("previous", "Previous selection", { ...previousPeriod, comparison });
  const combined = [...current, ...previous];
  for (const [name, items] of [
    ["current", current],
    ["previous", previous],
  ] as const) {
    for (const currency of new Set(items.map((t) => currencies.get(t.accountId) ?? "USD"))) {
      const currencyTrades = items.filter((t) => currencies.get(t.accountId) === currency);
      add(`${name}-currency-${sources.length}`, `${name}: ${currency}`, {
        ...period(currencyTrades),
        groups: Object.fromEntries(
          (["direction", "symbol", "playbook", "weekday", "mistake", "tag"] as const).map(
            (dimension) => [
              dimension,
              analyzeGroups(currencyTrades, dimension, undefined, timeZone).map((group) => ({
                ...group,
                row:
                  dimension === "playbook"
                    ? (strategyNames.get(group.row) ?? group.row)
                    : group.row,
              })),
            ],
          ),
        ),
      });
    }
  }
  const rowMap = new Map(
    [
      ...all.rows,
      ...(previousBounds ? queryTrades({ ...filters, ...previousBounds }).rows : []),
    ].map((r) => [r.key, r]),
  );
  const currentKeys = new Set(current.map((t) => t.key));
  const ruleChecks = db.select().from(tradeRuleChecks).all();
  for (const t of combined) {
    add(
      `trade-${sources.length}`,
      `${t.symbol} · ${dayKeyOf(t.closedAt!, timeZone)}`,
      {
        selection: currentKeys.has(t.key) ? "current" : "previous",
        ...t,
        account: accountRows.find((a) => a.id === t.accountId)?.name,
        strategy: strategyNames.get(t.annotations?.playbook ?? "") ?? "Unassigned",
        currency: currencies.get(t.accountId),
        realizedR: tradeR(t),
        note: rowMap.get(t.key)?.notes ?? "",
        recordedRuleChecks: ruleChecks
          .filter((r) => r.tradeKey === t.key)
          .map((r) => ({ strategy: r.playbookId, rule: r.rule, followed: r.followed })),
      },
      `/trades?trade=${encodeURIComponent(t.key)}`,
    );
  }
  const strategyIds = new Set(combined.map((t) => t.annotations?.playbook).filter(Boolean));
  for (const p of strategies.filter((p) => strategyIds.has(p.id)))
    add(
      `strategy-${sources.length}`,
      p.name,
      { id: p.id, name: p.name, description: p.description, rules: JSON.parse(p.rulesJson) },
      "/strategies",
    );
  const inPeriod = (date: string) =>
    [currentPeriod, previousPeriod].some((p) => p.from && p.to && date >= p.from && date <= p.to);
  const days = db
    .select()
    .from(journalDays)
    .all()
    .filter((d) => inPeriod(d.date));
  for (const day of days)
    if (day.note.trim())
      add(
        `day-${day.date}`,
        `Shared day reflection · ${day.date}`,
        { ...day, scope: "Shared across all accounts, not exclusive to this selection" },
        `/journal?focusDate=${day.date}`,
      );
  const rules = db
    .select()
    .from(progressRules)
    .all()
    .map((r) => ({ ...r, weekdays: JSON.parse(r.weekdaysJson) as number[] }));
  const checks = db
    .select()
    .from(progressChecks)
    .all()
    .filter((c) => inPeriod(c.date));
  for (const rule of rules) {
    for (const [name, items] of [
      ["current", current],
      ["previous", previous],
    ] as const) {
      for (const currency of new Set(items.map((t) => currencies.get(t.accountId)))) {
        const eligible = items.filter(
          (t) =>
            currencies.get(t.accountId) === currency &&
            scheduledRules([rule], dayKeyOf(t.closedAt!, timeZone)).length,
        );
        if (!eligible.length) continue;
        add(`routine-comparison-${sources.length}`, `${name}: ${rule.title} · ${currency}`, {
          scope:
            "Shared daily routine status; association only. Current schedule used. Multiple trades on a day are not independent routine observations.",
          groups: ["completed", "not completed", "unknown"].map((status) => {
            const group = eligible.filter((t) => {
              const check = checks.find(
                (c) => c.ruleId === rule.id && c.date === dayKeyOf(t.closedAt!, timeZone),
              );
              return (check ? (check.done ? "completed" : "not completed") : "unknown") === status;
            });
            return {
              status,
              days: new Set(group.map((t) => dayKeyOf(t.closedAt!, timeZone))).size,
              ...period(group),
            };
          }),
        });
      }
    }
  }
  const dateSet = new Set([
    ...combined.map((t) => dayKeyOf(t.closedAt!, timeZone)),
    ...days.map((d) => d.date),
    ...checks.map((c) => c.date),
  ]);
  for (const date of [...dateSet].sort()) {
    const scheduled = scheduledRules(rules, date);
    if (scheduled.length)
      add(
        `routines-${date}`,
        `Shared routines · ${date}`,
        scheduled.map((r) => {
          const check = checks.find((c) => c.date === date && c.ruleId === r.id);
          return {
            routine: r.title,
            stage: r.stage,
            status: check
              ? check.done
                ? "recorded completed"
                : "recorded not completed"
              : "not recorded",
          };
        }),
        "/routines",
      );
  }
  const keys = new Set(combined.map((t) => t.key));
  const notebook = db.select().from(notes).all();
  const candidates = notebook.filter((n) =>
    n.tradeKey ? keys.has(n.tradeKey) : n.dayDate ? inPeriod(n.dayDate) : true,
  );
  const suggested = (n: (typeof notebook)[number]) =>
    Boolean((n.tradeKey && keys.has(n.tradeKey)) || (n.dayDate && inPeriod(n.dayDate)));
  const ids = selectedNotes ?? candidates.filter(suggested).map((n) => n.id);
  requireValue(
    ids.every((id) => candidates.some((n) => n.id === id)),
    "A selected note is unavailable or outside this selection. Refresh the review context.",
  );
  for (const n of candidates.filter((n) => ids.includes(n.id)))
    add(
      `note-${n.id}`,
      n.title || "Untitled note",
      {
        content: n.content,
        coveredDay: n.dayDate,
        tradeKey: n.tradeKey,
        scope:
          n.tradeKey || n.dayDate
            ? "Linked journal note"
            : "Trader-selected general context; covered period unknown. Do not infer it from creation date.",
      },
      `/notebook?note=${encodeURIComponent(n.id)}`,
    );
  const label = Object.values(filters).some(Boolean)
    ? describeFilters(filters, accountRows, [], false)
    : "All closed trades";
  const id = createHash("sha256")
    .update(JSON.stringify({ filters, timeZone, compare, sources }))
    .digest("hex");
  return {
    compare,
    id,
    label,
    comparison,
    current: currentPeriod,
    previous: previousPeriod,
    sources,
    notes: candidates
      .sort(
        (a, b) =>
          Number(suggested(b)) - Number(suggested(a)) ||
          Number(/review/i.test(b.title)) - Number(/review/i.test(a.title)) ||
          b.updatedAt.localeCompare(a.updatedAt),
      )
      .map((n) => ({
        id: n.id,
        title: n.title || "Untitled note",
        suggested: suggested(n),
        reason: suggested(n)
          ? "Linked to this selection"
          : /review/i.test(n.title)
            ? "Review — confirm relevant period"
            : "General context — select if relevant",
      })),
  };
}
