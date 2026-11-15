/** Price-based, gross excursions. R is total entry risk, never final loss. */
export interface ExcursionFill {
  time: number;
  price: number;
  quantity: number;
  entry: boolean;
}
export interface ExcursionCandle {
  time: number;
  high: number;
  low: number;
}
export interface ExcursionValues {
  maeR: number;
  mfeR: number;
  realizedR: number;
  risk: number;
}
export interface ExcursionView {
  maeR: number | null;
  mfeR: number | null;
  realizedR: number | null;
  reason: string;
}
export interface ExcursionSummary {
  total: number;
  covered: number;
  winners: number;
  maeR: number | null;
  mfeR: number | null;
  realizedR: number | null;
  winnerMaeR: number | null;
}

export const EXCURSION_METHOD =
  "MAE shows the largest loss reached during a trade. MFE shows the largest profit reached. Both include realized and unrealized P&L, before costs, and are expressed in R.\n\n1R is the combined risk of all entries relative to your original stop-loss.\n\nEstimated from 1-minute prices. Candles containing an entry or exit may overstate the extremes.";

export function entryRisk(
  fills: ExcursionFill[],
  direction: "long" | "short",
  stop: number,
): number {
  const sign = direction === "long" ? 1 : -1;
  if (!Number.isFinite(stop) || stop <= 0) throw new Error("Original SL is missing or invalid.");
  let risk = 0;
  for (const fill of fills) {
    if (
      ![fill.time, fill.price, fill.quantity].every(Number.isFinite) ||
      fill.quantity <= 0 ||
      fill.price <= 0
    )
      throw new Error("Invalid execution data.");
    if (!fill.entry) continue;
    const distance = sign * (fill.price - stop);
    if (distance <= 0) throw new Error("Original SL must be a loss stop for every entry.");
    risk += distance * fill.quantity;
  }
  if (!(risk > 0) || !Number.isFinite(risk)) throw new Error("Entry risk is unavailable.");
  return risk;
}

export function calculateExcursions(
  fills: ExcursionFill[],
  direction: "long" | "short",
  stop: number,
  candles: ExcursionCandle[],
): ExcursionValues {
  const risk = entryRisk(fills, direction, stop);
  const sign = direction === "long" ? 1 : -1;
  const bars = new Map(candles.map((bar) => [bar.time, bar]));
  let quantity = 0,
    cash = 0,
    low = 0,
    high = 0;
  const mark = (price: number) => {
    const pnl = cash + sign * quantity * price;
    low = Math.min(low, pnl);
    high = Math.max(high, pnl);
  };
  for (let i = 0; i < fills.length; i++) {
    const fill = fills[i]!;
    mark(fill.price);
    quantity += fill.entry ? fill.quantity : -fill.quantity;
    cash += sign * fill.quantity * fill.price * (fill.entry ? -1 : 1);
    if (quantity < -1e-8) throw new Error("Executions do not describe a complete position.");
    if (Math.abs(quantity) < 1e-8) quantity = 0;
    mark(fill.price);
    const next = fills[i + 1];
    if (!next) break;
    if (next.time < fill.time) throw new Error("Executions are not chronological.");
    if (quantity === 0 || next.time === fill.time) continue;
    // Every position segment uses overlapping minute bars. This deliberately
    // yields an envelope, not invented intraminute ordering at scale/exit fills.
    for (let time = Math.floor(fill.time / 60000) * 60000; time < next.time; time += 60000) {
      const bar = bars.get(time);
      if (
        !bar ||
        !Number.isFinite(bar.high) ||
        !Number.isFinite(bar.low) ||
        bar.low <= 0 ||
        bar.high < bar.low
      )
        throw new Error("Complete, valid 1-minute price history is unavailable.");
      mark(bar.low);
      mark(bar.high);
    }
  }
  if (quantity !== 0 || fills.length < 2) throw new Error("Position is not closed.");
  const result = {
    maeR: Math.max(0, -low / risk),
    mfeR: Math.max(0, high / risk),
    realizedR: cash / risk,
    risk,
  };
  if (!Object.values(result).every(Number.isFinite)) throw new Error("Invalid excursion result.");
  return result;
}

export function summarizeExcursions(
  rows: { status: string; excursion: ExcursionView }[],
): ExcursionSummary {
  const closed = rows.filter((row) => row.status !== "open");
  const covered = closed.filter(({ excursion: e }) =>
    [e.maeR, e.mfeR, e.realizedR].every((v) => v !== null && Number.isFinite(v)),
  );
  const winners = covered.filter((row) => row.status === "win");
  const average = (items: typeof covered, field: "maeR" | "mfeR" | "realizedR") =>
    items.length ? items.reduce((sum, row) => sum + row.excursion[field]!, 0) / items.length : null;
  return {
    total: closed.length,
    covered: covered.length,
    winners: winners.length,
    maeR: average(covered, "maeR"),
    mfeR: average(covered, "mfeR"),
    realizedR: average(covered, "realizedR"),
    winnerMaeR: average(winners, "maeR"),
  };
}
