import { expect, it } from "vitest";
import {
  calculateExcursions,
  summarizeExcursions,
  type ExcursionFill,
} from "../src/lib/excursions";

const fill = (minute: number, price: number, quantity: number, entry: boolean): ExcursionFill => ({
  time: minute * 60000,
  price,
  quantity,
  entry,
});

it("measures short excursions against original risk, not the exit loss", () => {
  const result = calculateExcursions(
    [fill(0, 100, 2, true), fill(2, 101, 2, false)],
    "short",
    105,
    [
      { time: 0, high: 102, low: 96 },
      { time: 60000, high: 101, low: 95 },
    ],
  );
  expect(result).toEqual({ maeR: 0.4, mfeR: 1, realizedR: -0.2, risk: 10 });
});

it("keeps partial profits and uses total entry risk when scaling in and out", () => {
  const result = calculateExcursions(
    [
      fill(0, 100, 10, true),
      fill(1, 110, 5, false),
      fill(2, 102, 5, true),
      fill(3, 104, 10, false),
    ],
    "long",
    95,
    [
      { time: 0, high: 110, low: 98 },
      { time: 60000, high: 112, low: 100 },
      { time: 120000, high: 105, low: 99 },
    ],
  );
  expect(result.risk).toBe(85);
  expect(result.maeR).toBeCloseTo(20 / 85);
  expect(result.mfeR).toBeCloseTo(110 / 85);
  expect(result.realizedR).toBeCloseTo(80 / 85);
});

it("does not include the candle starting at an exact exit boundary", () => {
  const result = calculateExcursions([fill(0, 100, 1, true), fill(1, 101, 1, false)], "long", 95, [
    { time: 0, high: 102, low: 99 },
    { time: 60000, high: 200, low: 1 },
  ]);
  expect(result.mfeR).toBe(0.4);
  expect(result.maeR).toBe(0.2);
});

it("uses an explicit candle envelope for executions inside a minute", () => {
  const result = calculateExcursions(
    [
      { ...fill(0, 100, 1, true), time: 10000 },
      { ...fill(0, 101, 1, false), time: 50000 },
    ],
    "long",
    95,
    [{ time: 0, high: 103, low: 98 }],
  );
  expect(result.maeR).toBe(0.4);
  expect(result.mfeR).toBe(0.6);
});

it("rejects gaps and stops that are not protective for every entry", () => {
  const fills = [fill(0, 100, 1, true), fill(2, 102, 1, false)];
  expect(() => calculateExcursions(fills, "long", 95, [{ time: 0, high: 101, low: 99 }])).toThrow(
    /history/,
  );
  expect(() => calculateExcursions(fills, "long", 101, [])).toThrow(/loss stop/);
});

it("uses the same covered cohort for all three averages, preserving zero values", () => {
  const summary = summarizeExcursions([
    { status: "win", excursion: { maeR: 0, mfeR: 2, realizedR: 1, reason: "" } },
    { status: "loss", excursion: { maeR: 1, mfeR: 0, realizedR: -1, reason: "" } },
    {
      status: "loss",
      excursion: { maeR: null, mfeR: null, realizedR: null, reason: "Missing SL" },
    },
    { status: "open", excursion: { maeR: null, mfeR: null, realizedR: null, reason: "Open" } },
  ]);
  expect(summary).toEqual({
    total: 3,
    covered: 2,
    winners: 1,
    maeR: 0.5,
    mfeR: 1,
    realizedR: 0,
    winnerMaeR: 0,
  });
});
