"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { postJson, useApi } from "@/lib/use-api";

export function DemoSettings() {
  const { data, error } = useApi<{ accountId: string | null; active: boolean; current: boolean }>(
    "/api/demo",
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const active = data?.active && data.current;
  return (
    <Card id="demo-data" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Demo data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Explore 50 fictional crypto futures trades over 90 days, with long and short trades, no
          open positions and a $50,000 starting balance.
        </p>
        <p className="text-xs text-muted-foreground">
          Demo data uses its own account. Select it in the account menu; delete it under Accounts.
        </p>
        {data?.accountId && !data.current && (
          <p className="text-xs text-muted-foreground">
            Loading replaces the old demo trades and their notes with the new crypto dataset.
          </p>
        )}
        {(failure || error) && (
          <p role="alert" className="text-xs text-destructive">
            {failure || error}
          </p>
        )}
        <Button
          disabled={!data || busy || Boolean(active)}
          onClick={async () => {
            setBusy(true);
            setFailure("");
            try {
              await postJson("/api/demo", {});
              window.dispatchEvent(new Event("tj:api-refresh"));
            } catch (e) {
              setFailure(e instanceof Error ? e.message : "Could not load demo data.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Loading…" : active ? "Demo data active" : "Load demo data"}
        </Button>
      </CardContent>
    </Card>
  );
}
