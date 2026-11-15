// Share the budget across accounts, keys and Next route bundles in this process.
// Bitunix limits by UID, so separate API keys must not get independent budgets.
const globalQueue = globalThis as typeof globalThis & {
  bitunixRequestQueue?: { tail: Promise<void>; nextAt: number };
};
const queue = (globalQueue.bitunixRequestQueue ??= { tail: Promise.resolve(), nextAt: 0 });
const INTERVAL_MS = 150; // comfortably below the documented 10 requests/sec/UID

export const waitForBitunixRequest = (): Promise<void> => {
  const turn = queue.tail.then(async () => {
    while (queue.nextAt > Date.now()) {
      await new Promise((resolve) => setTimeout(resolve, queue.nextAt - Date.now()));
    }
    queue.nextAt = Date.now() + INTERVAL_MS;
  });
  queue.tail = turn.catch(() => {});
  return turn;
};

export const pauseBitunixRequests = (milliseconds: number): void => {
  queue.nextAt = Math.max(queue.nextAt, Date.now() + milliseconds);
};
