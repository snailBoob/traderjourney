import type { AnalysisFilters } from "@traderjourney/core";

/** Reuse the shared filter field; Reports limits closed trades by closing time. */
export function reportSelection<T extends AnalysisFilters & { entries?: string }>(values: T) {
  const { entries, ...filters } = values;
  return { ...filters, ...(entries ? { lastTrades: entries } : {}) };
}
