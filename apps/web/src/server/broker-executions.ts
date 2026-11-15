import type { BrokerSnapshot } from "@luxalgo/broker-sdk";
import type { ImportedExecution } from "@traderjourney/importers";
import { executionHash } from "./ids";
import { requireValue } from "./api";

/** These adapters had no trade history before SDK 0.6; existing broker hashes stay unchanged. */
export const hasNewSdkHistory = (broker: string): boolean =>
  broker === "binance" || broker === "webull";

export function brokerExecutions(broker: string, snapshot: BrokerSnapshot): ImportedExecution[] {
  const scoped = hasNewSdkHistory(broker);
  return snapshot.accounts.flatMap((account) => {
    const occurrences = new Map<string, number>();
    return account.trades.map((trade): ImportedExecution => {
      const row: ImportedExecution = {
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee ?? 0,
        executedAt: trade.executedAt ?? "",
        ...(trade.assetClass
          ? { assetClass: trade.assetClass === "cash" ? "other" : trade.assetClass }
          : {}),
      };
      if (scoped) {
        const multiplier =
          trade.multiplier ??
          (broker === "binance" && trade.assetClass === "futures" ? 1 : undefined);
        requireValue(
          trade.assetClass !== "option" ||
            (multiplier !== undefined && Number.isFinite(multiplier) && multiplier > 0),
          `The broker did not report a valid option contract size for ${trade.symbol}; nothing was imported.`,
        );
        const group = JSON.stringify([
          "broker",
          broker,
          account.id,
          trade.positionSide ?? "net",
          multiplier ?? null,
        ]);
        // The SDK has no source execution ID. Preserve multiplicity within a snapshot,
        // with identities independent of page order and of the requested history window.
        const fingerprint = `${executionHash(row)}:${trade.positionEffect ?? ""}`;
        const occurrenceKey = `${group}:${fingerprint}`;
        const occurrence = occurrences.get(occurrenceKey) ?? 0;
        occurrences.set(occurrenceKey, occurrence + 1);
        row.importMetadata = {
          id: `${fingerprint}:${occurrence}`,
          group,
          order: occurrence,
          preserveFee: true,
          ...(multiplier !== undefined ? { contractMultiplier: multiplier } : {}),
          ...(trade.positionEffect ? { positionEffect: trade.positionEffect } : {}),
        };
      }
      return row;
    });
  });
}
