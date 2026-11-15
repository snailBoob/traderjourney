import { createHash } from "node:crypto";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db, accounts, executions, excursionResults, trades } from "@/db";
import {
  calculateExcursions,
  entryRisk,
  EXCURSION_METHOD,
  type ExcursionFill,
  type ExcursionView,
} from "@/lib/excursions";
import type { TradeRow } from "./trades-query";
import { fetchExcursionCandles } from "./excursion-market-data";
import { logWarn } from "./logger";

const unavailable = (reason: string): ExcursionView => ({
  maeR: null,
  mfeR: null,
  realizedR: null,
  reason,
});
const state = globalThis as typeof globalThis & { excursionJobs?: Map<string, Promise<void>> };
const active = (state.excursionJobs ??= new Map<string, Promise<void>>());
const RETRY_MS = 5 * 60000;
type Task = {
  row: TradeRow;
  fills: ExcursionFill[];
  fingerprint: string;
  broker: string;
  symbol: string;
};
const supported = new Set(["bitunix", "binance", "kucoin", "hyperliquid"]);

/** Slice flat-crossing fills using the round-trip engine's attributed quantities. */
function inputs(row: TradeRow, byId: Map<string, typeof executions.$inferSelect>): ExcursionFill[] {
  const ids = JSON.parse(row.executionIdsJson) as string[];
  const exits = JSON.parse(row.exitsJson) as { executionId: string; quantity: number }[];
  const entrySide = row.direction === "long" ? "buy" : "sell";
  const fills = ids.map((id) => {
    const execution = byId.get(id);
    if (!execution) throw new Error("Execution history is incomplete.");
    const entry = execution.side === entrySide;
    const quantity = entry
      ? execution.quantity
      : exits
          .filter((exit) => exit.executionId === id)
          .reduce((sum, exit) => sum + exit.quantity, 0);
    return { time: Date.parse(execution.executedAt), price: execution.price, quantity, entry };
  });
  const entries = fills.filter((fill) => fill.entry);
  const first = entries[0];
  if (!first) throw new Error("Entry history is missing.");
  first.quantity = row.quantity - entries.slice(1).reduce((sum, fill) => sum + fill.quantity, 0);
  return fills;
}

export function readExcursions(rows: TradeRow[]) {
  const brokers = new Map(
    db
      .select({ id: accounts.id, broker: accounts.broker })
      .from(accounts)
      .all()
      .map((a) => [a.id, a.broker]),
  );
  const cache = new Map(
    db
      .select()
      .from(excursionResults)
      .all()
      .map((r) => [r.tradeKey, r]),
  );
  const accountIds = [
    ...new Set(
      rows.filter((r) => supported.has(brokers.get(r.accountId) ?? "")).map((r) => r.accountId),
    ),
  ];
  const byId = new Map<string, typeof executions.$inferSelect>();
  for (const id of accountIds) {
    for (const fill of db.select().from(executions).where(eq(executions.accountId, id)).all())
      byId.set(fill.id, fill);
  }
  const views = new Map<string, ExcursionView>();
  const tasks: Task[] = [];
  let waitingForCandle = false;
  for (const row of rows) {
    if (row.status === "open" || !row.closedAt) {
      views.set(row.key, unavailable("Available after the trade closes."));
      continue;
    }
    const broker = brokers.get(row.accountId) ?? "";
    if (!supported.has(broker)) {
      views.set(
        row.key,
        unavailable("Automatic MAE/MFE price history is unavailable for this broker."),
      );
      continue;
    }
    if (row.stopLoss === null) {
      views.set(row.key, unavailable("Enter the original SL to calculate MAE/MFE in R."));
      continue;
    }
    try {
      if (broker === "binance" && row.assetClass !== "futures")
        throw new Error("Binance MAE/MFE requires a USDⓈ-M futures trade.");
      let symbol = row.symbol;
      if (broker === "kucoin") {
        const pairs = (JSON.parse(row.executionIdsJson) as string[]).map((id) => {
          const raw = byId.get(id)?.sourceInstrumentJson;
          const instrument = raw ? JSON.parse(raw) : undefined;
          return instrument?.broker === "kucoin" ? instrument.symbol : undefined;
        });
        if (
          !pairs.length ||
          typeof pairs[0] !== "string" ||
          pairs.some((pair) => pair !== pairs[0])
        )
          throw new Error("The exact KuCoin pair is unavailable or differs between executions.");
        if (pairs[0].split("-")[0] !== row.symbol)
          throw new Error("The KuCoin source pair does not match this trade.");
        symbol = pairs[0];
      }
      const fills = inputs(row, byId);
      entryRisk(fills, row.direction, row.stopLoss);
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify(
            broker === "bitunix"
              ? [1, row.symbol, row.direction, row.stopLoss, row.closedAt, fills]
              : [2, broker, symbol, row.direction, row.stopLoss, row.closedAt, fills],
          ),
        )
        .digest("hex");
      const cached = cache.get(row.key);
      if (cached?.fingerprint === fingerprint) {
        const view = JSON.parse(cached.resultJson) as ExcursionView;
        if (view.maeR !== null) view.reason = EXCURSION_METHOD;
        views.set(row.key, view);
        const waiting = view.reason === "Waiting for the final 1-minute candle to close.";
        const retryAt = waiting
          ? Math.ceil(fills.at(-1)!.time / 60000) * 60000 + 2000
          : cached.attemptedAt + RETRY_MS;
        if (view.maeR !== null || Date.now() < retryAt) {
          waitingForCandle ||= waiting;
          continue;
        }
      } else {
        views.set(row.key, unavailable("MAE/MFE calculation pending."));
      }
      tasks.push({ row, fills, fingerprint, broker, symbol });
    } catch (error) {
      views.set(
        row.key,
        unavailable(error instanceof Error ? error.message : "Invalid trade data."),
      );
    }
  }
  return { views, tasks, pending: tasks.length > 0 || waitingForCandle };
}

async function calculate(task: Task): Promise<void> {
  const { row, fills, fingerprint } = task;
  let view: ExcursionView;
  try {
    const candles = await fetchExcursionCandles(
      task.symbol,
      fills[0]!.time,
      fills.at(-1)!.time,
      task.broker,
    );
    const result = calculateExcursions(fills, row.direction, row.stopLoss!, candles);
    view = {
      maeR: result.maeR,
      mfeR: result.mfeR,
      realizedR: result.realizedR,
      reason: EXCURSION_METHOD,
    };
  } catch (error) {
    view = unavailable(error instanceof Error ? error.message : "Price history unavailable.");
    logWarn("excursions", "excursions.unavailable", { tradeKey: row.key, reason: view.reason });
  }
  // A trade may be edited/deleted while the public API request is in flight.
  const current = db.select().from(trades).where(eq(trades.key, row.key)).get();
  if (!current) return;
  const currentTask = readExcursions([current]).tasks[0];
  if (currentTask?.fingerprint !== fingerprint) return;
  db.insert(excursionResults)
    .values({
      tradeKey: row.key,
      fingerprint,
      resultJson: JSON.stringify(view),
      attemptedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: excursionResults.tradeKey,
      set: { fingerprint, resultJson: JSON.stringify(view), attemptedAt: Date.now() },
    })
    .run();
}

export async function processExcursions(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    const key = `${task.row.key}:${task.fingerprint}`;
    let job = active.get(key);
    if (!job) {
      const current = db.select().from(trades).where(eq(trades.key, task.row.key)).get();
      if (
        !current ||
        !readExcursions([current]).tasks.some((next) => next.fingerprint === task.fingerprint)
      )
        continue;
      job = calculate(task).finally(() => active.delete(key));
      active.set(key, job);
    }
    await job;
  }
}

/** Bounded batches finish after the response; pending clients request the next batch. */
export function scheduleExcursions(tasks: Task[]): void {
  if (tasks.length) after(() => processExcursions(tasks.slice(0, 10)));
}

export async function refreshAccountExcursions(accountId: string): Promise<void> {
  const rows = db.select().from(trades).where(eq(trades.accountId, accountId)).all();
  await processExcursions(readExcursions(rows).tasks);
}
