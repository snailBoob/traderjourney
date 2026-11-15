import { handler, ok, requireValue } from "@/server/api";
import { db, executions, trades } from "@/db";
import { deleteExecution, updateExecution } from "@/server/executions";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

interface Body {
  symbol?: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee: number;
  executedAt: string;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const body = (await request.json()) as Partial<Body>;
  requireValue(
    body.symbol === undefined || (typeof body.symbol === "string" && body.symbol.trim().length > 0),
    "Symbol is required.",
  );
  requireValue(body.side === "buy" || body.side === "sell", "Side must be buy or sell.");
  requireValue(
    typeof body.quantity === "number" && Number.isFinite(body.quantity) && body.quantity > 0,
    "Quantity must be greater than zero.",
  );
  requireValue(
    typeof body.price === "number" && Number.isFinite(body.price),
    "Price must be a finite number.",
  );
  requireValue(
    typeof body.fee === "number" && Number.isFinite(body.fee),
    "Fee must be a finite number.",
  );
  requireValue(
    typeof body.executedAt === "string" && Number.isFinite(Date.parse(body.executedAt)),
    "Timestamp is invalid.",
  );
  const tradeKey = updateExecution(id, {
    ...(body.symbol !== undefined ? { symbol: body.symbol } : {}),
    side: body.side,
    quantity: body.quantity,
    price: body.price,
    fee: body.fee,
    executedAt: body.executedAt,
  });
  return ok({ updated: true, tradeKey });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const execution = db.select().from(executions).where(eq(executions.id, id)).get();
  requireValue(execution, "Execution not found.");

  const containingTrade = db
    .select({ executionIdsJson: trades.executionIdsJson })
    .from(trades)
    .where(eq(trades.accountId, execution!.accountId))
    .all()
    .find((row) => (JSON.parse(row.executionIdsJson) as string[]).includes(id));

  if (containingTrade) {
    const executionIds = JSON.parse(containingTrade.executionIdsJson) as string[];
    requireValue(executionIds.length > 1, "A trade must keep at least one execution.");
  }

  const tradeKey = deleteExecution(id);
  return ok({ deleted: true, tradeKey });
});
