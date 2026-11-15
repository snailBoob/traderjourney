import { expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listBrokers, getAdapter } from "@luxalgo/broker-sdk";
import { BROKERS, brokerDetails, connectionStatus } from "../src/lib/brokers";
import { brokerExecutions } from "../src/server/broker-executions";
import sources from "../public/brokers/sources.json";

const require = createRequire(import.meta.url);
const roster = listBrokers();
const icons: Record<string, { file: string }> = sources;

it("covers the SDK roster and Bitunix with locally served broker icons", () => {
  const ids = [...roster.map((broker) => broker.id), "bitunix"].sort();
  expect(Object.keys(BROKERS).sort()).toEqual(ids);
  expect(Object.keys(icons).sort()).toEqual(ids);
  for (const id of ids)
    expect(existsSync(join(import.meta.dirname, "../public/brokers", icons[id]!.file))).toBe(true);
});

it.each(roster)(
  "normalizes $displayName official SDK examples and maps supported history",
  (broker) => {
    const vector =
      broker.id === "binance"
        ? "binance-usdm-futures"
        : broker.id === "webull"
          ? "webull-v3"
          : broker.id;
    const fixture = JSON.parse(
      readFileSync(
        require.resolve(`@luxalgo/broker-sdk/conformance/vectors/${vector}.json`),
        "utf8",
      ),
    );
    const accounts = getAdapter(broker.id)!.normalize(fixture.raw);
    expect(accounts).toEqual(fixture.expected);
    const rows = brokerExecutions(broker.id, {
      broker: broker.id,
      fetchedAt: "2026-11-13T00:00:00.000Z",
      accounts,
    });
    const trades = accounts.flatMap((account) => account.trades);
    expect(
      rows.map(({ symbol, side, quantity, price, fee, executedAt }) => ({
        symbol,
        side,
        quantity,
        price,
        fee,
        executedAt,
      })),
    ).toEqual(
      trades.map((trade) => ({
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        price: trade.price,
        fee: trade.fee ?? 0,
        executedAt: trade.executedAt ?? "",
      })),
    );
    expect(brokerDetails(broker.id).history).toBe(rows.length ? "available" : "unavailable");
  },
);

it("never claims that untested credentials are connected", () => {
  expect(connectionStatus({ connected: true, lastSyncAt: null, snapshot: null })).toBe("unknown");
  expect(connectionStatus({ connected: true, lastSyncAt: "2026-11-13", snapshot: null })).toBe(
    "connected",
  );
  expect(
    connectionStatus({
      connected: true,
      lastSyncAt: "2026-11-13",
      snapshot: { connectionStatus: "unknown" },
    }),
  ).toBe("unknown");
  expect(brokerDetails("future-broker").history).toBe("unknown");
});
