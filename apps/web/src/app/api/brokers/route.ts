import { listBrokers } from "@/server/sync";
import { bitunixBroker } from "@/server/sync";
import { handler, ok } from "@/server/api";

/** Broker roster straight from @luxalgo/broker-sdk plus the test Bitunix adapter. */
export const GET = handler(() =>
  ok({
    brokers: [...listBrokers(), bitunixBroker].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    ),
  }),
);
