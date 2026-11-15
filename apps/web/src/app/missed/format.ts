import type { Missed, Outcome } from "./types";
export const outcomeLabel = (outcome: Outcome | null) => {
  if (outcome === "back_to_entry") return "Back to entry";
  if (outcome === "extended_to_2r") return "Extended to 2R";
  return "—";
};

export const dateKey = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
};

export const formatDate = (value: string) => {
  const key = dateKey(value);
  const parsed = new Date(`${key}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? key : parsed.toLocaleDateString();
};

export const rulesFollowedPercent = (row: Missed) =>
  row.ruleReview.assessed > 0
    ? Math.round((row.ruleReview.followed / row.ruleReview.assessed) * 100)
    : null;
