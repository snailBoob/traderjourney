import { describe, expect, it } from "vitest";
import { fittingEntryCount, widestEntryColumns } from "../src/lib/fitting-entry-count";

describe("entry content fitting", () => {
  it("uses the widest content per selected column for one uniform list layout", () => {
    const widths = widestEntryColumns(
      ["date", "pnl", "trades", "winrate"],
      [
        { date: 100, pnl: 60, trades: 50, winrate: 60 },
        { date: 70, pnl: 50, trades: 50, winrate: 50 },
      ],
    );
    expect(widths).toEqual([100, 60, 50, 60]);
    expect(fittingEntryCount(widths, 280)).toBe(3);
    expect(fittingEntryCount(widths, 400)).toBe(4);
    expect(widestEntryColumns(["pnl", "date"], [{ date: 100, pnl: 60 }])).toEqual([60, 100]);
  });
  it("fits four short fields but three longer fields in the same space", () => {
    expect(fittingEntryCount([70, 50, 50, 50], 280)).toBe(4);
    expect(fittingEntryCount([100, 60, 50, 60], 280)).toBe(3);
  });
  it("includes exact fits and removes an entire field when a single pixel is missing", () => {
    expect(fittingEntryCount([70, 50, 50, 50], 256)).toBe(4);
    expect(fittingEntryCount([70, 50, 50, 50], 255)).toBe(3);
  });
  it("respects priority, selection and oversized first fields", () => {
    expect(fittingEntryCount([100, 200, 20], 250)).toBe(1);
    expect(fittingEntryCount([20, 100, 200], 250)).toBe(2);
    expect(fittingEntryCount([300], 250)).toBe(0);
    expect(fittingEntryCount([], 250)).toBe(0);
  });
});
