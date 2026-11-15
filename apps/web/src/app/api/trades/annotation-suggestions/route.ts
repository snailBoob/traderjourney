import { db, missedTrades, trades } from "@/db";
import { handler, ok } from "@/server/api";

const parseArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
};

interface AnnotationRow {
  tagsJson: string | null;
  mistakesJson: string | null;
  reasonForExitJson: string | null;
  patternDuringTradeJson: string | null;
}

const collect = (values: string[][]): string[] => {
  const counts = new Map<string, number>();
  for (const list of values) {
    for (const raw of list) {
      const value = raw.trim();
      if (!value) continue;
      const existing = [...counts.keys()].find(
        (key) => key.toLocaleLowerCase() === value.toLocaleLowerCase(),
      );
      counts.set(existing ?? value, (counts.get(existing ?? value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
};

export const GET = handler(() => {
  const rows = db
    .select({
      tagsJson: trades.tagsJson,
      mistakesJson: trades.mistakesJson,
      reasonForExitJson: trades.reasonForExitJson,
      patternDuringTradeJson: trades.priceActionJson,
    })
    .from(trades)
    .all();

  const missedTagRows = db.select({ tagsJson: missedTrades.tagsJson }).from(missedTrades).all();

  return ok({
    // Tags are shared between Trades and Missed Trades; other suggestions come from their matching trade fields.
    tags: collect([
      ...rows.map((row: AnnotationRow) => parseArray(row.tagsJson)),
      ...missedTagRows.map((row) => parseArray(row.tagsJson)),
    ]),
    mistakes: collect(rows.map((row: AnnotationRow) => parseArray(row.mistakesJson))),
    reasonForExit: collect(rows.map((row: AnnotationRow) => parseArray(row.reasonForExitJson))),
    patternDuringTrade: collect(
      rows.map((row: AnnotationRow) => parseArray(row.patternDuringTradeJson)),
    ),
  });
});
