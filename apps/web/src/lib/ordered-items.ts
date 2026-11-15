/** Retain saved order, omit removed items, and append new items in source order. */
export function orderedItems<T extends { id: string }>(items: T[], saved: unknown): T[] {
  const ids = Array.isArray(saved)
    ? saved.filter((id): id is string => typeof id === "string")
    : [];
  const remaining = new Map(items.map((item) => [item.id, item]));
  const result: T[] = [];
  for (const id of ids) {
    const item = remaining.get(id);
    if (item) result.push(item);
    remaining.delete(id);
  }
  return [...result, ...remaining.values()];
}
