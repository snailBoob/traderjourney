import { and, eq } from "drizzle-orm";
import { db, playbooks, tradeRuleChecks } from "@/db";
import { getTradeByKey } from "@/server/trades-query";
import { handler, ok, requireValue } from "@/server/api";
type Context = { params: Promise<{ key: string }> };
function source(key: string, selectedPlaybookId?: string | null) {
  const trade = getTradeByKey(key);
  requireValue(trade, "Trade not found.");
  const playbookId = selectedPlaybookId === undefined ? trade.playbookId : selectedPlaybookId;
  const book = playbookId
    ? db.select().from(playbooks).where(eq(playbooks.id, playbookId)).get()
    : null;
  return { book, rules: book ? [...new Set(JSON.parse(book.rulesJson) as string[])] : [] };
}
export const GET = handler(async (request: Request, { params }: Context) => {
  const key = (await params).key;
  const searchParams = new URL(request.url).searchParams;
  const selectedPlaybookId = searchParams.has("playbook")
    ? searchParams.get("playbook")
    : undefined;
  const { book, rules } = source(key, selectedPlaybookId);
  const checks = book
    ? db
        .select()
        .from(tradeRuleChecks)
        .where(and(eq(tradeRuleChecks.tradeKey, key), eq(tradeRuleChecks.playbookId, book.id)))
        .all()
    : [];
  return ok({
    name: book?.name ?? null,
    rules: rules.map((rule) => ({
      rule,
      followed: checks.find((c) => c.rule === rule)?.followed ?? null,
    })),
  });
});
export const POST = handler(async (request: Request, { params }: Context) => {
  const key = (await params).key,
    b = await request.json();
  const { book, rules } = source(key, typeof b.playbookId === "string" ? b.playbookId : undefined);
  requireValue(
    book && rules.includes(b.rule) && (b.followed === null || typeof b.followed === "boolean"),
    "Choose an existing strategy rule.",
  );
  const id = JSON.stringify([key, book.id, b.rule]);
  if (b.followed === null) db.delete(tradeRuleChecks).where(eq(tradeRuleChecks.id, id)).run();
  else
    db.insert(tradeRuleChecks)
      .values({ id, tradeKey: key, playbookId: book.id, rule: b.rule, followed: b.followed })
      .onConflictDoUpdate({ target: tradeRuleChecks.id, set: { followed: b.followed } })
      .run();
  return ok({ saved: true });
});
