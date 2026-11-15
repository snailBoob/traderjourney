# @traderjourney/core

The pure domain engine behind TraderJourney. No IO, no framework, zero runtime dependencies. Runs in Node and the browser.

Private workspace package; installed from the repository with `pnpm install`.

## What it does

Feed it raw executions (fills); it gives you everything a journal displays.

```ts
import {
  buildRoundTrips,
  computeMetrics,
  computeEdgeScore,
  calendarMonth,
  dailyStats,
  dailyCumulative,
  equityCurve,
} from "@traderjourney/core";

const trades = buildRoundTrips(executions, { method: "fifo" });
const metrics = computeMetrics(trades, { timeZone: "America/New_York" });
const edge = computeEdgeScore(metrics);
const calendar = calendarMonth(trades, 2026, 8, "America/New_York");
```

- `buildRoundTrips` turns fills into flat-to-flat trades: partial fills, scale-ins, flips, futures multipliers, FIFO / LIFO / weighted-average lot matching. Deterministic, with rebuild-stable trade keys.
- `computeMetrics` produces win rates, profit factor, expectancy, streaks, drawdown and recovery, R multiples, profit concentration.
- `computeEdgeScore` is the open, versioned 0 to 100 composite; the formula lives in [docs/edge-score.md](../../docs/edge-score.md).
- `calendarMonth`, `dailyStats`, `dailyCumulative`, `equityCurve`, `intradayCurve` feed the calendar and every chart. Day bucketing is timezone-aware and DST-safe.

MIT; see the repository [license](../../LICENSE).
