"use client";

import { MonetaryField, MonetaryValue } from "@/components/privacy";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { postJson, useApi } from "@/lib/use-api";
import { fmtMoney } from "@/lib/utils";
import { CircleHelp, Landmark } from "lucide-react";
import type { AccountRow } from "./types";
export function CapitalCard({ accounts }: { accounts: AccountRow[] }) {
  const { data: settings, refresh } = useApi<{ totalCapital: number | null }>("/api/settings");
  const total = settings?.totalCapital ?? null;
  const allocated = accounts.reduce((sum, account) => sum + account.initialBalance, 0);
  const reserve = total === null ? null : total - allocated;
  const save = async (raw: string) => {
    const text = raw.trim();
    const next = text === "" ? null : Number(text);
    if (next === total) return;
    if (next !== null && (!Number.isFinite(next) || next < 0)) return;
    await postJson("/api/settings", { totalCapital: next }, "PATCH");
    refresh();
  };
  return (
    <div className="px-4 pt-4">
      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Landmark className="h-4 w-4 text-muted-foreground" />
              Total capital
              <span title="Your whole trading pot across all accounts. Dashboard drawdown percentages use this when the capital basis is set to Total.">
                <CircleHelp className="h-4 w-4 text-muted-foreground" />
              </span>
            </label>
            <MonetaryField>
              <Input
                key={total === null ? "empty" : total}
                defaultValue={total ?? ""}
                placeholder="Not set"
                inputMode="decimal"
                onBlur={(event) => void save(event.target.value)}
                className="mt-2 max-w-44 bg-background"
              />
            </MonetaryField>
            <div className="mt-1 text-xs text-muted-foreground">
              The pot that backs every account, regardless of leverage.
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">Allocated</div>
            <div className="mt-2 text-2xl font-semibold tracking-tight tnum">
              <MonetaryValue>{fmtMoney(allocated)}</MonetaryValue>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Sum of account initial balances (excludes archived).
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">Reserve</div>
            <div
              className={`mt-2 text-2xl font-semibold tracking-tight tnum ${reserve !== null && reserve < 0 ? "text-loss" : ""}`}
            >
              {reserve === null ? (
                <span className="text-lg font-normal text-muted-foreground">—</span>
              ) : (
                <MonetaryValue>{fmtMoney(reserve)}</MonetaryValue>
              )}
            </div>
            <div
              className={`mt-1 text-xs ${reserve !== null && reserve < 0 ? "text-loss" : "text-muted-foreground"}`}
            >
              {reserve === null
                ? "Set total capital to see what stays unallocated."
                : reserve < 0
                  ? "Allocated exceeds total capital."
                  : "Capital not assigned to any account."}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
