import { brokerDetails } from "@/lib/brokers";
import { requireValue } from "./api";

export function syncStartDate(broker: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    requireValue(
      brokerDetails(broker).startDate !== "required",
      "Sync start date is required for Bitunix.",
    );
    return null;
  }
  requireValue(
    brokerDetails(broker).startDate !== "none",
    "This connector does not support a trade-history start date.",
  );
  requireValue(
    typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "Sync start date must be a valid date at midnight UTC.",
  );
  return value;
}
