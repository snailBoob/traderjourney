export interface AccountRow {
  id: string;
  name: string;
  broker: string;
  kind: "sync" | "import" | "manual";
  currency: string;
  initialBalance: number;
  profitCalcMethod: "fifo" | "lifo" | "wavg";
  lastSyncAt: string | null;
  syncStartAt: string | null;
  archivedAt: string | null;
  connected: boolean;
  snapshot: {
    equity: number | null;
    positions: unknown[];
    openOrders?: unknown[];
    currency?: string | null;
    brokerAccountCount?: number;
    fetchedAt?: string;
    connectionStatus?: "connected" | "disconnected" | "unknown";
    syncStatus?: "success" | "error";
    connectionMessage?: string | null;
    syncMessage?: string | null;
  } | null;
}
export interface AccountMessage {
  title: string;
  body: string;
}
