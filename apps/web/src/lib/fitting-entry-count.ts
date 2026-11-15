/** Keep the chosen priority order; never skip a wide field to fit later fields. */
export function fittingEntryCount(widths: number[], available: number, gap = 12): number {
  let used = 0;
  let count = 0;
  for (const width of widths) {
    const next = used + (count ? gap : 0) + width;
    if (next > available) break;
    used = next;
    count++;
  }
  return count;
}

export function widestEntryColumns(ids: string[], rows: Record<string, number>[]): number[] {
  return ids.map((id) => Math.max(0, ...rows.map((row) => row[id] ?? 0)));
}
