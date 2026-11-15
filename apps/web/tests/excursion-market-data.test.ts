import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/server/bitunix-request-queue", () => ({
  waitForBitunixRequest: vi.fn(),
  pauseBitunixRequests: vi.fn(),
}));
import { fetchExcursionCandles } from "../src/server/excursion-market-data";
afterEach(() => vi.unstubAllGlobals());

it("paginates backwards with exclusive endTime, normalizes strings and needs no API key", async () => {
  const mock = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    expect(url.searchParams.get("symbol")).toBe("KGENUSDT");
    expect(url.searchParams.get("type")).toBe("LAST_PRICE");
    expect(init.headers).toBeUndefined();
    const end = Number(url.searchParams.get("endTime"));
    const times =
      end === 201 * 60000 ? Array.from({ length: 200 }, (_, i) => (200 - i) * 60000) : [0];
    return Response.json({
      code: 0,
      data: times.map((time) => ({ time: String(time), high: "102", low: "99" })),
    });
  });
  vi.stubGlobal("fetch", mock);
  const result = await fetchExcursionCandles("KGENUSDT", 10000, 200 * 60000 + 30000);
  expect(result).toHaveLength(201);
  expect(result[0]).toEqual({ time: 0, high: 102, low: 99 });
  expect(mock).toHaveBeenCalledTimes(2);
});

it.each(["binance", "kucoin"])(
  "paginates %s with the exact symbol and correct OHLC ordering",
  async (broker) => {
    const mock = vi.fn(async (input: string) => {
      const url = new URL(input);
      const binance = broker === "binance";
      expect(url.hostname).toBe(binance ? "fapi.binance.com" : "api.kucoin.com");
      expect(url.searchParams.get("symbol")).toBe(binance ? "BTCUSDT" : "BTC-USDC");
      const start =
        Number(url.searchParams.get(binance ? "startTime" : "startAt")) * (binance ? 1 : 1000);
      const end =
        Number(url.searchParams.get(binance ? "endTime" : "endAt")) * (binance ? 1 : 1000);
      const data = Array.from({ length: Math.ceil((end - start) / 60000) }, (_, i) =>
        binance
          ? [start + i * 60000, "100", "105", "95", "101"]
          : [String(start / 1000 + i * 60), "100", "101", "105", "95"],
      );
      return Response.json(binance ? data : { code: "200000", data: data.reverse() });
    });
    vi.stubGlobal("fetch", mock);
    const bars = await fetchExcursionCandles(
      broker === "binance" ? "BTCUSDT" : "BTC-USDC",
      10000,
      1501 * 60000,
      broker,
    );
    expect(bars).toHaveLength(1501);
    expect(bars[1500]).toEqual({ time: 1500 * 60000, high: 105, low: 95 });
    expect(mock).toHaveBeenCalledTimes(2);
  },
);

it("preserves Hyperliquid coin names and rejects history outside its candle window", async () => {
  const start = Math.floor(Date.now() / 60000) * 60000 - 120000;
  const mock = vi.fn(async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string)).toEqual({
      type: "candleSnapshot",
      req: { coin: "xyz:XYZ100", interval: "1m", startTime: start, endTime: start + 59999 },
    });
    return Response.json([{ t: start, s: "xyz:XYZ100", i: "1m", h: "105", l: "95" }]);
  });
  vi.stubGlobal("fetch", mock);
  expect(await fetchExcursionCandles("xyz:XYZ100", start, start + 60000, "hyperliquid")).toEqual([
    { time: start, high: 105, low: 95 },
  ]);
  await expect(fetchExcursionCandles("BTC", 0, 60000, "hyperliquid")).rejects.toThrow(/5,000/);
  expect(mock).toHaveBeenCalledTimes(1);
});

it.each(
  [
    [[0, "100", "105", "95"]],
    [
      [0, "100", "105", "95"],
      [0, "100", "105", "95"],
    ],
    [
      [0, "100", "bad", "95"],
      [60000, "100", "105", "95"],
    ],
  ].map((data) => [data]),
)("rejects missing, duplicate and malformed candles", async (data) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(data)),
  );
  await expect(fetchExcursionCandles("BTCUSDT", 0, 120000, "binance")).rejects.toThrow();
});

it("does not guess incomplete symbols or request unfinished candles", async () => {
  vi.stubGlobal("fetch", vi.fn());
  await expect(fetchExcursionCandles("BTC", 0, 60000, "kucoin")).rejects.toThrow(/instrument/);
  await expect(
    fetchExcursionCandles("BTCUSDT", Date.now() - 60000, Date.now() + 60000, "binance"),
  ).rejects.toThrow(/candle to close/);
  expect(fetch).not.toHaveBeenCalled();
});

it("rejects empty pages instead of looping or inventing candles", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ code: 0, data: [] })),
  );
  await expect(fetchExcursionCandles("BTCUSDT", 0, 60000)).rejects.toThrow(/history/);
});

it("waits for the last required candle to close", async () => {
  vi.stubGlobal("fetch", vi.fn());
  await expect(
    fetchExcursionCandles("BTCUSDT", Date.now() - 60000, Date.now() + 30000),
  ).rejects.toThrow(/candle to close/);
  expect(fetch).not.toHaveBeenCalled();
});
