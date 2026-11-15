import type { ExcursionCandle } from "@/lib/excursions";
import { pauseBitunixRequests, waitForBitunixRequest } from "./bitunix-request-queue";

/** Public, exchange-matched LAST_PRICE candles; endTime is exclusive. */
export async function fetchExcursionCandles(
  symbol: string,
  from: number,
  to: number,
  broker = "bitunix",
): Promise<ExcursionCandle[]> {
  if (broker !== "bitunix") return fetchExchangeCandles(broker, symbol, from, to);
  if (!/^[A-Z0-9]+USDT$/.test(symbol)) throw new Error("Bitunix USDT instrument is unavailable.");
  const start = Math.floor(from / 60000) * 60000;
  let end = Math.ceil(to / 60000) * 60000;
  if (end > Math.floor(Date.now() / 60000) * 60000)
    throw new Error("Waiting for the final 1-minute candle to close.");
  const bars = new Map<number, ExcursionCandle>();
  while (end > start) {
    await waitForBitunixRequest();
    const query = new URLSearchParams({
      symbol,
      interval: "1m",
      type: "LAST_PRICE",
      endTime: String(end),
      limit: "200",
    });
    const response = await fetch(`https://fapi.bitunix.com/api/v1/futures/market/kline?${query}`, {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (response.status === 429) pauseBitunixRequests(5000);
    if (!response.ok) throw new Error("Bitunix price history is temporarily unavailable.");
    const body = (await response.json()) as {
      code: number;
      data?: { time: string | number; high: string; low: string }[];
    };
    if (body.code !== 0 || !Array.isArray(body.data))
      throw new Error("Bitunix price history is temporarily unavailable.");
    let earliest = end;
    for (const raw of body.data) {
      const bar = { time: Number(raw.time), high: Number(raw.high), low: Number(raw.low) };
      if (!Number.isSafeInteger(bar.time) || bar.time % 60000 !== 0 || bar.time >= end)
        throw new Error("Bitunix returned invalid candle timestamps.");
      earliest = Math.min(earliest, bar.time);
      if (bar.time >= start) bars.set(bar.time, bar);
    }
    if (earliest === end) throw new Error("Complete 1-minute price history is unavailable.");
    end = earliest;
  }
  return [...bars.values()].sort((a, b) => a.time - b.time);
}

// A shared queue bounds concurrent dashboard/sync requests, including rate-limit cooldowns.
let queue = Promise.resolve();
let nextRequest = 0;
async function publicRequest(url: string, init?: RequestInit, intervalMs = 300): Promise<unknown> {
  const job = queue.then(async () => {
    const delay = nextRequest - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
      if (response.status === 429 || response.status === 418) {
        const retry = Number(response.headers.get("retry-after"));
        nextRequest = Date.now() + Math.max(60000, Number.isFinite(retry) ? retry * 1000 : 0);
      }
      if (!response.ok) throw new Error("Exchange price history is temporarily unavailable.");
      return (await response.json()) as unknown;
    } finally {
      nextRequest = Math.max(nextRequest, Date.now() + intervalMs);
    }
  });
  queue = job.then(
    () => {},
    () => {},
  );
  return job;
}

async function fetchExchangeCandles(
  broker: string,
  symbol: string,
  from: number,
  to: number,
): Promise<ExcursionCandle[]> {
  if (
    !(broker === "binance" && /^[A-Z0-9]+(?:USDT|USDC)$/.test(symbol)) &&
    !(broker === "kucoin" && /^[A-Z0-9]+-[A-Z0-9]+$/.test(symbol)) &&
    !(
      broker === "hyperliquid" &&
      /^(?:[A-Za-z0-9]+:)?[A-Za-z0-9]+$|^@[0-9]+$|^PURR\/USDC$/.test(symbol)
    )
  )
    throw new Error("The exact exchange instrument is unavailable.");
  const start = Math.floor(from / 60000) * 60000;
  const end = Math.ceil(to / 60000) * 60000;
  const now = Math.floor(Date.now() / 60000) * 60000;
  if (end > now) throw new Error("Waiting for the final 1-minute candle to close.");
  if (broker === "hyperliquid" && start < now - 4999 * 60000)
    throw new Error("Hyperliquid only provides the latest 5,000 1-minute candles.");
  const bars: ExcursionCandle[] = [];
  const pageSize = broker === "binance" ? 1500 : broker === "kucoin" ? 1500 : 5000;
  for (let cursor = start; cursor < end;) {
    const until = Math.min(end, cursor + pageSize * 60000);
    let page: unknown;
    if (broker === "binance") {
      page = await publicRequest(
        `https://fapi.binance.com/fapi/v1/klines?${new URLSearchParams({ symbol, interval: "1m", startTime: String(cursor), endTime: String(until - 1), limit: "1500" })}`,
      );
    } else if (broker === "kucoin") {
      const body = (await publicRequest(
        `https://api.kucoin.com/api/v1/market/candles?${new URLSearchParams({ symbol, type: "1min", startAt: String(cursor / 1000), endAt: String(until / 1000) })}`,
      )) as { code?: string; data?: unknown };
      if (body?.code !== "200000")
        throw new Error("KuCoin price history is temporarily unavailable.");
      page = body.data;
    } else {
      page = await publicRequest(
        "https://api.hyperliquid.xyz/info",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "candleSnapshot",
            req: { coin: symbol, interval: "1m", startTime: cursor, endTime: until - 1 },
          }),
        },
        (20 + Math.ceil((until - cursor) / 60000 / 60)) * 60,
      );
    }
    if (!Array.isArray(page) || !page.length)
      throw new Error("Complete 1-minute price history is unavailable.");
    const normalized = page
      .map((raw): ExcursionCandle => {
        if (!raw || (broker !== "hyperliquid" && !Array.isArray(raw)))
          throw new Error("Invalid exchange candle data.");
        if (broker === "hyperliquid" && (raw.s !== symbol || raw.i !== "1m"))
          throw new Error("Unexpected candle instrument or interval.");
        const bar =
          broker === "hyperliquid"
            ? { time: Number(raw.t), high: Number(raw.h), low: Number(raw.l) }
            : {
                time: Number(raw[0]) * (broker === "kucoin" ? 1000 : 1),
                high: Number(raw[broker === "kucoin" ? 3 : 2]),
                low: Number(raw[broker === "kucoin" ? 4 : 3]),
              };
        if (
          !Number.isSafeInteger(bar.time) ||
          bar.time % 60000 !== 0 ||
          bar.time < cursor ||
          bar.time >= until ||
          !Number.isFinite(bar.high) ||
          !Number.isFinite(bar.low) ||
          bar.low <= 0 ||
          bar.high < bar.low
        )
          throw new Error("Invalid exchange candle data.");
        return bar;
      })
      .sort((a, b) => a.time - b.time);
    if (
      normalized.length !== (until - cursor) / 60000 ||
      normalized.some((bar, i) => bar.time !== cursor + i * 60000)
    )
      throw new Error("Complete 1-minute price history is unavailable.");
    bars.push(...normalized);
    cursor = until;
  }
  return bars;
}
