import { createHash, randomBytes } from "node:crypto";
import type { ImportedExecution } from "@traderjourney/importers";
import { logDebug, logError, logInfo } from "./logger";
import { pauseBitunixRequests, waitForBitunixRequest } from "./bitunix-request-queue";

const BASE_URL = "https://fapi.bitunix.com";
const LIMIT = 100;
const OVERLAP_MS = 5 * 60 * 1000;
const RECONCILIATION_MS = 48 * 60 * 60 * 1000;

export interface BitunixCredentials {
  apiKey: string;
  apiSecret: string;
}

interface BitunixTrade {
  tradeId: string;
  orderId: string;
  symbol: string;
  qty: string;
  positionMode: "ONE_WAY" | "HEDGE";
  marginMode: "ISOLATION" | "CROSS";
  leverage: number;
  price: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  reduceOnly: boolean;
  fee: string;
  realizedPNL: string;
  ctime: string | number;
  roleType?: "TAKER" | "MAKER";
}

interface BitunixPendingOrder {
  orderId: string;
  symbol: string;
  qty: string;
  tradeQty: string;
  status: "INIT" | "NEW" | "PART_FILLED" | string;
  ctime: string | number;
}

interface BitunixPendingTpSlOrder {
  id: string;
  positionId: string;
  symbol: string;
  tpQty?: string;
  slQty?: string;
}

type BitunixOpenOrder = BitunixPendingOrder | BitunixPendingTpSlOrder;

interface BitunixHistoryOrder {
  orderId: string;
  symbol: string;
  qty: string;
  tradeQty: string;
  side: "BUY" | "SELL";
  status: string;
  orderType?: "LIMIT" | "MARKET";
  price?: string;
  fee: string;
  realizedPNL: string;
  ctime: string | number;
}

interface BitunixAccount {
  marginCoin: string;
  available: string;
  frozen: string;
  margin: string;
  transfer: string;
  crossUnrealizedPNL: string;
  isolationUnrealizedPNL: string;
  bonus: string;
}

interface BitunixPosition {
  positionId: string;
  symbol: string;
  maxQty: string;
  entryPrice: string;
  side: "LONG" | "SHORT";
  positionMode: "ONE_WAY" | "HEDGE";
  marginMode: "ISOLATION" | "CROSS";
  leverage: number;
}

interface BitunixHistoryPosition {
  positionId: string;
  symbol: string;
  fee: string;
  funding: string;
  realizedPNL: string;
  ctime: string | number;
  mtime: string | number;
}

interface BitunixResponse<T> {
  code: number | string;
  msg?: string;
  data: T;
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const toFiniteNumber = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const nonce = (): string => randomBytes(16).toString("hex");

const canonicalQuery = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}${value}`)
    .join("");

const request = async <T>(
  credentials: BitunixCredentials,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> => {
  return (await requestWithMeta<T>(credentials, path, params)).data;
};

export const bitunixBrokerInfo = {
  id: "bitunix",
  displayName: "Bitunix",
  credentials: [
    { key: "apiKey", label: "API key" },
    { key: "apiSecret", label: "API secret", secret: true },
  ],
  readOnlySetup:
    "Create a Bitunix API key with read-only access. TraderJourney only reads your futures history and never places, changes or cancels orders.",
};

export const isBitunixCredentials = (
  value: Partial<BitunixCredentials>,
): value is BitunixCredentials => Boolean(value.apiKey?.trim() && value.apiSecret?.trim());

interface BitunixRequestResult<T> {
  data: T;
  status: number;
  code: number | string;
  msg?: string;
}

export class BitunixApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly apiMessage: string | null;
  readonly retryAfterMs: number;

  constructor(status: number, code: number | string, message?: string, retryAfterMs = 0) {
    super(message || `Bitunix API error (${status})`);
    this.name = "BitunixApiError";
    this.status = status;
    this.code = String(code);
    this.apiMessage = message ?? null;
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : 0;
  }
}

const requestWithMeta = async <T>(
  credentials: BitunixCredentials,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<BitunixRequestResult<T>> => {
  for (let attempt = 0; ; attempt += 1) {
    await waitForBitunixRequest();
    try {
      return await requestAttempt<T>(credentials, path, params);
    } catch (error) {
      if (
        !(error instanceof BitunixApiError) ||
        !(error.status === 429 || ["10005", "10006"].includes(error.code))
      )
        throw error;
      // Other syncs share this cooldown; each retry is signed after waiting.
      pauseBitunixRequests(Math.max(error.retryAfterMs, 1000 * 2 ** attempt));
      if (attempt >= 3) throw error;
      logInfo("Bitunix", "Rate limit: retry scheduled", { path, attempt: attempt + 1 });
    }
  }
};

const requestAttempt = async <T>(
  credentials: BitunixCredentials,
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<BitunixRequestResult<T>> => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const queryString = query.toString();
  const timestamp = String(Date.now());
  const requestNonce = nonce();
  const digest = sha256(requestNonce + timestamp + credentials.apiKey + canonicalQuery(params));
  const sign = sha256(digest + credentials.apiSecret);
  const url = `${BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;
  const startedAt = Date.now();
  logDebug("Bitunix", "API request", { path, params });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "api-key": credentials.apiKey,
        nonce: requestNonce,
        timestamp,
        sign,
        language: "en-US",
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    logError("Bitunix", "API request failed before receiving a response", error, {
      path,
      params,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = retryAfter
    ? Math.max(
        0,
        Number.isFinite(Number(retryAfter))
          ? Number(retryAfter) * 1000
          : Date.parse(retryAfter) - Date.now(),
      )
    : 0;
  // Gateways may return an HTML/plain-text 429 without a JSON envelope.
  if (response.status === 429) {
    throw new BitunixApiError(429, "429", "Bitunix rate limit reached", retryAfterMs);
  }
  const payload = (await response.json()) as BitunixResponse<T>;
  const durationMs = Date.now() - startedAt;
  logDebug("Bitunix", "API response", {
    path,
    status: response.status,
    code: payload.code,
    msg: payload.msg,
    durationMs,
    dataType: Array.isArray(payload.data) ? "array" : typeof payload.data,
    dataCount: Array.isArray(payload.data) ? payload.data.length : undefined,
    dataKeys:
      payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? Object.keys(payload.data as object)
        : undefined,
  });
  if (!response.ok || String(payload.code) !== "0") {
    logError("Bitunix", "API returned an error", undefined, {
      path,
      params,
      status: response.status,
      code: payload.code,
      msg: payload.msg,
      durationMs,
    });
    throw new BitunixApiError(response.status, payload.code, payload.msg, retryAfterMs);
  }
  return { data: payload.data, status: response.status, code: payload.code, msg: payload.msg };
};

const fetchTrades = async (
  credentials: BitunixCredentials,
  startTime: number,
  endTime: number,
  positionId?: string,
): Promise<{ trades: BitunixTrade[]; total: number; pages: number }> => {
  const all: BitunixTrade[] = [];
  let skip = 0;
  let total = 0;
  let pages = 0;
  while (true) {
    const page = await request<{ tradeList: BitunixTrade[]; total: string | number }>(
      credentials,
      "/api/v1/futures/trade/get_history_trades",
      { startTime, endTime, ...(positionId ? { positionId } : {}), skip, limit: LIMIT },
    );
    const rows = page.tradeList ?? [];
    total = toFiniteNumber(page.total) ?? 0;
    pages += 1;
    all.push(...rows);
    if (rows.length < LIMIT || all.length >= total) break;
    skip += LIMIT;
  }
  return { trades: all, total, pages };
};

const fetchHistoryOrders = async (
  credentials: BitunixCredentials,
  startTime: number,
  endTime: number,
): Promise<{ orders: BitunixHistoryOrder[]; total: number; pages: number }> => {
  const all: BitunixHistoryOrder[] = [];
  let skip = 0;
  let total = 0;
  let pages = 0;
  while (true) {
    const page = await request<{ orderList: BitunixHistoryOrder[]; total: string | number }>(
      credentials,
      "/api/v1/futures/trade/get_history_orders",
      { startTime, endTime, skip, limit: LIMIT },
    );
    const rows = page.orderList ?? [];
    total = toFiniteNumber(page.total) ?? 0;
    pages += 1;
    all.push(...rows);
    if (rows.length < LIMIT || all.length >= total) break;
    skip += LIMIT;
  }
  return { orders: all, total, pages };
};

const fetchHistoryPositions = async (
  credentials: BitunixCredentials,
  startTime: number,
  endTime: number,
): Promise<BitunixHistoryPosition[]> => {
  const all: BitunixHistoryPosition[] = [];
  let skip = 0;
  let total = 0;
  while (true) {
    const page = await request<{ positionList: BitunixHistoryPosition[]; total: string | number }>(
      credentials,
      "/api/v1/futures/position/get_history_positions",
      { startTime, endTime, skip, limit: LIMIT },
    );
    const rows = page.positionList ?? [];
    total = toFiniteNumber(page.total) ?? 0;
    all.push(...rows);
    if (rows.length < LIMIT || all.length >= total) break;
    skip += LIMIT;
  }
  return all;
};

const fetchPendingPositions = async (
  credentials: BitunixCredentials,
): Promise<BitunixPosition[]> => {
  return request<BitunixPosition[]>(credentials, "/api/v1/futures/position/get_pending_positions");
};

const fetchPendingOrders = async (
  credentials: BitunixCredentials,
): Promise<BitunixPendingOrder[]> => {
  const all: BitunixPendingOrder[] = [];
  let skip = 0;
  let total = 0;
  while (true) {
    const page = await request<{ orderList: BitunixPendingOrder[]; total: string | number }>(
      credentials,
      "/api/v1/futures/trade/get_pending_orders",
      { skip, limit: LIMIT },
    );
    const rows = page.orderList ?? [];
    total = toFiniteNumber(page.total) ?? 0;
    all.push(...rows);
    if (rows.length < LIMIT || skip + rows.length >= total) break;
    skip += LIMIT;
  }
  return all;
};

const fetchPendingTpSlOrders = async (
  credentials: BitunixCredentials,
): Promise<BitunixPendingTpSlOrder[]> => {
  const all: BitunixPendingTpSlOrder[] = [];
  let skip = 0;
  while (true) {
    const rows = await request<BitunixPendingTpSlOrder[]>(
      credentials,
      "/api/v1/futures/tpsl/get_pending_orders",
      { skip, limit: LIMIT },
    );
    const page = rows ?? [];
    all.push(
      ...page.filter((order) => Number(order.tpQty ?? 0) > 0 || Number(order.slQty ?? 0) > 0),
    );
    if (page.length < LIMIT) break;
    skip += LIMIT;
  }
  return all;
};

const fetchAccount = async (credentials: BitunixCredentials): Promise<BitunixAccount[]> => {
  // Bitunix returns a single account object here, unlike the history endpoints
  // which return lists. Keep the internal shape as an array so the sync result
  // can expose a stable account-record count.
  const payload = await request<BitunixAccount | BitunixAccount[]>(
    credentials,
    "/api/v1/futures/account",
    { marginCoin: "USDT" },
  );
  return Array.isArray(payload) ? payload : [payload];
};

const normalizeSyncStart = (value: string): number => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Bitunix sync start date is invalid.");
  const date = new Date(parsed);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

export interface BitunixSyncResult {
  rows: ImportedExecution[];
  /** Funding cost (paid positive, received negative), keyed by execution identity. */
  fundingByExecutionKey: Record<string, number>;
  positions: BitunixPosition[];
  openOrders: BitunixOpenOrder[];
  accounts: BitunixAccount[];
  fetchedAt: string;
  cursorAt: string;
  unresolvedPositionIds: string[];
  fundingBackfillComplete: boolean;
}

export const syncBitunix = async (
  credentials: BitunixCredentials,
  syncStartAt: string,
  lastSyncAt: string | null,
  fundingBackfill = true,
  previouslyUnresolvedPositionIds: string[] = [],
): Promise<BitunixSyncResult> => {
  const configuredStart = normalizeSyncStart(syncStartAt);
  const previous = lastSyncAt ? Date.parse(lastSyncAt) : NaN;
  const start = Math.max(
    configuredStart,
    Number.isFinite(previous) ? previous - OVERLAP_MS : configuredStart,
  );
  const end = Date.now();
  logInfo("Bitunix", "Sync started", {
    configuredSyncStartAt: syncStartAt,
    normalizedStartTime: start,
    normalizedStartIso: new Date(start).toISOString(),
    endTime: end,
    endIso: new Date(end).toISOString(),
    lastSyncAt: lastSyncAt ?? null,
    lastSyncAtMinusOverlap: Number.isFinite(previous) ? previous - OVERLAP_MS : null,
  });
  const historyOrderResult = await fetchHistoryOrders(credentials, start, end);

  // Position history carries the signed total funding separately from fill
  // fees. Resolve each closed position to its final fill through the endpoint's
  // positionId filter, then persist funding against that closing execution.
  // Initial/versioned reconciliation reads all positions. Normal syncs also
  // revisit the last 48 hours even when the exchange leaves mtime unchanged.
  const historyPositions = await fetchHistoryPositions(credentials, configuredStart, end);
  const positions = await fetchPendingPositions(credentials);

  // Bitunix executions are grouped by the exchange position they belong to.
  // A BUY/SELL side alone cannot distinguish opening from closing a position.
  // The history-trades endpoint supports a positionId filter, so use that as
  // the authoritative relationship instead of reconstructing all positions
  // from one ungrouped symbol-level stream.
  const unresolvedBefore = new Set(previouslyUnresolvedPositionIds);
  const relevantHistoryPositions = historyPositions.filter((position) => {
    const modifiedAt = toFiniteNumber(position.mtime);
    return (
      fundingBackfill ||
      modifiedAt === null ||
      modifiedAt >= start ||
      modifiedAt >= end - RECONCILIATION_MS ||
      unresolvedBefore.has(position.positionId)
    );
  });
  const positionIds = [
    ...new Set(
      [...relevantHistoryPositions, ...positions]
        .map((position) => position.positionId)
        .filter(
          (positionId): positionId is string =>
            typeof positionId === "string" && positionId.length > 0,
        ),
    ),
  ];
  // Sequential position reads avoid an unbounded fan-out and stop issuing new
  // work after an unrecoverable error. Pagination/retries use the same limiter.
  const positionTrades = [];
  for (const positionId of positionIds) {
    positionTrades.push({
      positionId,
      result: await fetchTrades(credentials, configuredStart, end, positionId),
    });
  }
  const tradesByPosition = new Map(
    positionTrades.map(({ positionId, result }) => [positionId, result]),
  );
  const unresolvedPositionIds = positionTrades
    .filter(({ positionId, result }) => {
      if (result.trades.length === 0 || result.trades.length < result.total) return true;
      if (!relevantHistoryPositions.some((position) => position.positionId === positionId))
        return false;
      const net = result.trades.reduce(
        (sum, trade) => sum + (trade.side === "BUY" ? 1 : -1) * Number(trade.qty),
        0,
      );
      const volume = result.trades.reduce((sum, trade) => sum + Math.abs(Number(trade.qty)), 0);
      // A closed position with unmatched quantity may be an eventually-consistent response.
      return !Number.isFinite(net) || Math.abs(net) > Math.max(1e-8, volume * 1e-10);
    })
    .map(({ positionId }) => positionId);
  const trades = positionTrades.flatMap(({ positionId, result }) =>
    result.trades.map((trade, positionOrder) => ({ ...trade, positionId, positionOrder })),
  );
  const uniqueTrades = [...new Map(trades.map((trade) => [trade.tradeId, trade])).values()];
  const tradeResult = {
    trades: uniqueTrades,
    total: positionTrades.reduce((sum, item) => sum + item.result.total, 0),
    pages: positionTrades.reduce((sum, item) => sum + item.result.pages, 0),
  };
  const fundingByExecutionKey: Record<string, number> = {};
  let fundingPositionsResolved = 0;
  let fundingBackfillComplete = unresolvedPositionIds.length === 0;
  for (const position of relevantHistoryPositions) {
    // Do not move funding to a provisional "final" fill in an incomplete response.
    if (unresolvedPositionIds.includes(position.positionId)) continue;
    const funding = toFiniteNumber(position.funding);
    if (funding === null || position.funding == null || position.funding === "") {
      fundingBackfillComplete = false;
      unresolvedPositionIds.push(position.positionId);
      continue;
    }
    // Bitunix position funding is a signed cash flow: negative is paid,
    // positive is received. The journal stores costs with the opposite sign.
    // Confirmed against BEAMXUSDT 2026-10-30 12:00 UTC: a long paid
    // 90,000 * 0.004718 * 0.00005 = 0.021231, returned as -0.021231.
    const fundingCost = -funding;
    const positionTradeResult = tradesByPosition.get(position.positionId);
    if (!positionTradeResult || positionTradeResult.trades.length === 0) continue;
    const finalFill = positionTradeResult.trades.reduce((latest, candidate) => {
      const latestTime = toFiniteNumber(latest.ctime) ?? Number.NEGATIVE_INFINITY;
      const candidateTime = toFiniteNumber(candidate.ctime) ?? Number.NEGATIVE_INFINITY;
      // Equal timestamps sort by import order in the round-trip engine. The
      // last API row at that timestamp is therefore the actual final fill.
      return candidateTime >= latestTime ? candidate : latest;
    });
    if (!finalFill.tradeId || !finalFill.orderId) {
      fundingBackfillComplete = false;
      unresolvedPositionIds.push(position.positionId);
      continue;
    }
    // Repair funding attached to an earlier same-time fill by older versions;
    // also propagate exchange corrections back to zero, without double-counting.
    for (const trade of positionTradeResult.trades) {
      fundingByExecutionKey[`bitunix:${trade.tradeId}`] = 0;
      fundingByExecutionKey[`bitunix:order:${trade.orderId}`] = 0;
    }
    const tradeKey = `bitunix:${finalFill.tradeId}`;
    fundingByExecutionKey[tradeKey] = (fundingByExecutionKey[tradeKey] ?? 0) + fundingCost;
    const orderKey = `bitunix:order:${finalFill.orderId}`;
    fundingByExecutionKey[orderKey] = (fundingByExecutionKey[orderKey] ?? 0) + fundingCost;
    fundingPositionsResolved += 1;
  }

  // Bitunix's history-trades endpoint is the authoritative execution source.
  // Some accounts/API responses can nevertheless return no trade rows while
  // history-orders still contains filled quantities. In that case use the
  // order fills as a conservative fallback so the journal is not silently empty.
  const tradeRows: ImportedExecution[] = uniqueTrades.flatMap((trade) => {
    // Bitunix currently serializes numeric fields such as ctime as JSON strings.
    // Do not use Number.isFinite directly on the raw API value: that rejects
    // numeric strings and silently turns every valid fill into a skipped row.
    const ctime = toFiniteNumber(trade.ctime);
    if (ctime === null) return [];
    return [
      {
        symbol: trade.symbol,
        side: trade.side === "BUY" ? "buy" : "sell",
        quantity: Number(trade.qty),
        price: Number(trade.price),
        fee: Math.abs(Number(trade.fee)),
        executedAt: new Date(ctime).toISOString(),
        assetClass: "futures",
        importMetadata: {
          id: `bitunix:${trade.tradeId}`,
          group: `bitunix-position:${trade.positionId}`,
          order: trade.positionOrder,
          reportedGrossPnl: Number(trade.realizedPNL),
          preserveFee: true,
        },
      },
    ];
  });

  const fallbackRows: ImportedExecution[] =
    tradeRows.length === 0 && historyPositions.length === 0 && positions.length === 0
      ? historyOrderResult.orders.flatMap((order, index) => {
          const ctime = toFiniteNumber(order.ctime);
          const price = Number(order.price);
          const quantity = Number(order.tradeQty);
          if (ctime === null || quantity <= 0 || !Number.isFinite(price) || price <= 0) return [];
          return [
            {
              symbol: order.symbol,
              side: order.side === "BUY" ? "buy" : "sell",
              quantity,
              price,
              fee: Math.abs(Number(order.fee)),
              executedAt: new Date(ctime).toISOString(),
              assetClass: "futures",
              importMetadata: {
                id: `bitunix:order:${order.orderId}`,
                order: index,
                reportedGrossPnl: Number(order.realizedPNL),
                preserveFee: true,
              },
            },
          ];
        })
      : [];

  // Do not fall back to ungrouped order rows when position-filtered trade
  // history is available: BUY/SELL alone can manufacture a phantom round trip.
  const rows = tradeRows.length > 0 ? tradeRows : fallbackRows;
  const importSource =
    tradeRows.length > 0
      ? ("history-trades" as const)
      : fallbackRows.length > 0
        ? ("history-orders-fallback" as const)
        : ("none" as const);
  const pendingOrders = await fetchPendingOrders(credentials);
  const pendingTpSlOrders = await fetchPendingTpSlOrders(credentials);
  const openOrders = [...pendingOrders, ...pendingTpSlOrders];
  const accountSnapshot = await fetchAccount(credentials);
  logInfo("Bitunix", "Sync data collected", {
    positionIdsQueried: positionIds.length,
    positionIdsWithoutExecutions: unresolvedPositionIds,
    historyTradesTotal: tradeResult.total,
    historyTradesReturned: trades.length,
    historyTradesPages: tradeResult.pages,
    historyOrdersTotal: historyOrderResult.total,
    historyOrdersReturned: historyOrderResult.orders.length,
    historyOrdersPages: historyOrderResult.pages,
    importedRows: rows.length,
    importSource,
    fallbackRows: fallbackRows.length,
    positions: positions.length,
    historicalPositions: historyPositions.length,
    fundingPositionsResolved,
    fundingBackfill,
    openOrders: openOrders.length,
    pendingOrders: pendingOrders.length,
    pendingTpSlOrders: pendingTpSlOrders.length,
    accountRecords: accountSnapshot.length,
  });
  return {
    rows,
    fundingByExecutionKey,
    positions,
    openOrders,
    accounts: accountSnapshot,
    fetchedAt: new Date().toISOString(),
    cursorAt: new Date(end).toISOString(),
    unresolvedPositionIds: [...new Set(unresolvedPositionIds)],
    fundingBackfillComplete,
  };
};
