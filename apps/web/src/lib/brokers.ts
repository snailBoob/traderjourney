/** Trade-history support in @luxalgo/broker-sdk 0.7.0, plus our Bitunix adapter.
 * These are connector capabilities, not claims about the broker's entire API.
 */
export interface BrokerDetails {
  name: string;
  history: "available" | "unavailable" | "unknown";
  historyNote: string;
  startDate: "required" | "optional" | "none";
}

const history = (
  name: string,
  historyNote = "Imports the history returned by the broker. Its lookback and page limits still apply.",
): BrokerDetails => ({ name, history: "available", historyNote, startDate: "optional" });
const balances = (name: string): BrokerDetails => ({
  name,
  history: "unavailable",
  startDate: "none",
  historyNote:
    "This connector reads account values and positions, but does not import trades. Use a trade-history file to import trades.",
});

export const BROKERS: Record<string, BrokerDetails> = {
  alpaca: history("Alpaca"),
  binance: history(
    "Binance",
    "Imports USDⓈ-M futures fills from approximately the last 3 months. Spot balances are included, but spot trades are not imported. Futures access must be enabled on the key.",
  ),
  bybit: balances("Bybit"),
  coinbase: balances("Coinbase"),
  "crypto-com": balances("Crypto.com"),
  etrade: history(
    "E*TRADE",
    "Imports the recent transaction window returned by E*TRADE (up to 30 days). Older history requires a file import.",
  ),
  gemini: balances("Gemini"),
  hyperliquid: history(
    "Hyperliquid",
    "Imports the recent fills returned by Hyperliquid. Older fills may be outside the broker's response limit.",
  ),
  "ibkr-flex": history(
    "Interactive Brokers",
    "Imports trades included in your Flex query. The query's date range and statement timezone determine the available history.",
  ),
  kraken: balances("Kraken"),
  kucoin: history(
    "KuCoin",
    "Imports the recent fills returned by KuCoin (up to 100 per request with this connector). Older history may require a file import.",
  ),
  okx: balances("OKX"),
  public: history(
    "Public",
    "Imports the recent history window returned by Public (up to 30 days). Older history may require a file import.",
  ),
  questrade: history(
    "Questrade",
    "Imports activity from the last 30 days. Older history requires a file import.",
  ),
  "robinhood-crypto": history("Robinhood Crypto"),
  schwab: history(
    "Charles Schwab",
    "Imports trade transactions from the last 90 days. Older history requires a file import.",
  ),
  tastytrade: history("tastytrade"),
  topstep: history(
    "Topstep",
    "Imports trades from the last 30 days. Older history requires a file import.",
  ),
  tradestation: balances("TradeStation"),
  tradier: history("Tradier"),
  trading212: balances("Trading212"),
  webull: history(
    "Webull",
    "Imports settled, single-leg orders with fills, up to one year back by default. Working and multi-leg orders are not imported. The broker's retention limits still apply.",
  ),
  bitunix: {
    ...history(
      "Bitunix",
      "Imports futures history from the selected date, including position reconciliation and funding where available.",
    ),
    startDate: "required",
  },
};

export const brokerDetails = (id: string): BrokerDetails =>
  BROKERS[id] ?? {
    name: id || "Broker",
    history: "unknown",
    startDate: "none",
    historyNote: "History support has not been verified for this connector.",
  };

export type BrokerConnectionStatus = "connected" | "disconnected" | "unknown";

export function connectionStatus(account: {
  connected: boolean;
  lastSyncAt: string | null;
  snapshot: { connectionStatus?: BrokerConnectionStatus } | null;
}): BrokerConnectionStatus {
  return (
    account.snapshot?.connectionStatus ??
    (account.lastSyncAt && account.connected ? "connected" : "unknown")
  );
}

export function syncSummary(result: {
  inserted: number;
  duplicates: number;
  skipped: number;
  excluded?: number;
}): string {
  const parts = [
    `${result.inserted} new ${result.inserted === 1 ? "fill" : "fills"}`,
    `${result.duplicates} already imported`,
  ];
  if (result.skipped) parts.push(`${result.skipped} skipped`);
  if (result.excluded) parts.push(`${result.excluded} before the start date`);
  return parts.join(" · ");
}
