import { and, eq, inArray } from "drizzle-orm";
import type { ImportedExecution } from "@traderjourney/importers";
import {
  accounts,
  attachments,
  db,
  executions,
  notes,
  settings,
  snapshots,
  tradeRuleChecks,
  trades,
} from "@/db";
import { insertExecutions } from "./executions";
import { newId, nowIso } from "./ids";

export const DEMO_BROKER = "demo";
const DATASET = "crypto-futures-50-v1";

// USDT perpetual underlyings in CoinMarketCap's top 50, consulted 2026-11-09:
// https://coinmarketcap.com/. Stablecoins excluded. Fixed universe, not a live
// ranking; prices and trades are fictional.
const SYMBOLS = [
  ["BTC", 75000],
  ["ETH", 2100],
  ["BNB", 690],
  ["XRP", 1.1],
  ["SOL", 86],
  ["TRX", 0.32],
  ["ZEC", 1170],
  ["HYPE", 75],
  ["XMR", 590],
  ["DOGE", 0.07],
  ["LINK", 10.7],
  ["ADA", 0.18],
  ["XLM", 0.15],
  ["BCH", 238],
  ["NEAR", 3.65],
  ["UNI", 7],
  ["LTC", 51],
  ["AVAX", 8.6],
  ["SUI", 0.84],
  ["HBAR", 0.07],
  ["TAO", 222],
  ["QNT", 195],
  ["ENA", 0.15],
  ["AAVE", 131],
  ["ONDO", 0.37],
  ["ASTER", 0.65],
  ["WLFI", 0.05],
  ["MNT", 0.45],
  ["DOT", 0.86],
] as const;

function generateExecutions(): ImportedExecution[] {
  let seed = 42;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows: ImportedExecution[] = [];
  for (let i = 0; i < 50; i++) {
    const [base, price] = SYMBOLS[Math.floor(rnd() * SYMBOLS.length)]!;
    const symbol = `${base}USDT`;
    const long = rnd() < 0.5;
    const entry = Number((price * (0.9 + rnd() * 0.2)).toPrecision(8));
    const quantity = Number(((2000 + rnd() * 8000) / entry).toPrecision(6));
    const move = (rnd() < 0.55 ? 1 : -1) * (0.005 + rnd() * 0.035);
    const exit = Number((entry * (1 + (long ? move : -move))).toPrecision(8));
    // Distinct days prevent same-symbol positions merging. Include weekends.
    const day = 90 - Math.round((i * 89) / 49);
    const opened = today.getTime() - day * 86400000 + Math.floor(rnd() * 20 * 60) * 60000;
    const closed = opened + (15 + Math.floor(rnd() * 180)) * 60000;
    for (const [side, fillPrice, time] of [
      [long ? "buy" : "sell", entry, opened],
      [long ? "sell" : "buy", exit, closed],
    ] as const) {
      rows.push({
        symbol,
        side,
        quantity,
        price: fillPrice,
        fee: Number((quantity * fillPrice * 0.0005).toFixed(4)),
        executedAt: new Date(time).toISOString(),
        assetClass: "futures",
      });
    }
  }
  return rows;
}

export function getDemoStatus() {
  const account = db.select().from(accounts).where(eq(accounts.broker, DEMO_BROKER)).get();
  const version =
    account &&
    db
      .select()
      .from(settings)
      .where(eq(settings.key, `demo.dataset.${account.id}`))
      .get();
  return {
    accountId: account?.id ?? null,
    active: Boolean(account && !account.archivedAt),
    current: version?.value === DATASET,
  };
}

export interface DemoResult {
  accountId: string;
  inserted: number;
  alreadyLoaded: boolean;
}

/** Replace legacy demo data atomically; subsequent activations preserve annotations. */
export const loadDemoData = (): DemoResult =>
  db.transaction(
    () => {
      const status = getDemoStatus();
      const id = status.accountId ?? newId();
      if (status.current) {
        db.update(accounts).set({ archivedAt: null }).where(eq(accounts.id, id)).run();
        return { accountId: id, inserted: 0, alreadyLoaded: true };
      }
      if (status.accountId) {
        const keys = db
          .select({ key: trades.key })
          .from(trades)
          .where(eq(trades.accountId, id))
          .all()
          .map((t) => t.key);
        if (keys.length) {
          const noteIds = db
            .select({ id: notes.id })
            .from(notes)
            .where(inArray(notes.tradeKey, keys))
            .all()
            .map((n) => n.id);
          if (noteIds.length)
            db.delete(attachments)
              .where(and(eq(attachments.ownerType, "note"), inArray(attachments.ownerId, noteIds)))
              .run();
          db.delete(notes).where(inArray(notes.tradeKey, keys)).run();
          db.delete(attachments)
            .where(and(eq(attachments.ownerType, "trade"), inArray(attachments.ownerId, keys)))
            .run();
          db.delete(snapshots)
            .where(and(eq(snapshots.ownerType, "trade"), inArray(snapshots.ownerId, keys)))
            .run();
          db.delete(tradeRuleChecks).where(inArray(tradeRuleChecks.tradeKey, keys)).run();
        }
        db.delete(trades).where(eq(trades.accountId, id)).run();
        db.delete(executions).where(eq(executions.accountId, id)).run();
        db.update(accounts)
          .set({ name: "Demo data", initialBalance: 50000, currency: "USD", archivedAt: null })
          .where(eq(accounts.id, id))
          .run();
      } else {
        db.insert(accounts)
          .values({
            id,
            name: "Demo data",
            broker: DEMO_BROKER,
            kind: "import",
            currency: "USD",
            initialBalance: 50000,
            profitCalcMethod: "fifo",
            createdAt: nowIso(),
          })
          .run();
      }
      const { inserted } = insertExecutions(id, generateExecutions(), "import", undefined, {
        preserveFees: true,
      });
      db.insert(settings)
        .values({ key: `demo.dataset.${id}`, value: DATASET })
        .onConflictDoUpdate({ target: settings.key, set: { value: DATASET } })
        .run();
      return { accountId: id, inserted, alreadyLoaded: false };
    },
    { behavior: "immediate" },
  );
