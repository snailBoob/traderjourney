import { redirect } from "next/navigation";
import { tradeKeyFromSegment } from "@/lib/trade-links";

/** Legacy trade URLs redirect to the corresponding expanded row in Trades. */
export default async function TradePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tradeKey = tradeKeyFromSegment(key);
  redirect(`/trades?expand=${encodeURIComponent(tradeKey)}`);
}
