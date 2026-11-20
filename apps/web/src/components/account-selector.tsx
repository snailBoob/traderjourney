"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Landmark, WalletCards } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "./ui/select";
import { cn } from "@/lib/utils";
import { useApi } from "@/lib/use-api";
import { saveUiPreference } from "@/lib/ui-preferences-client";
import { publishHeaderNotice } from "@/lib/header-notice";
import type { CapitalBasis } from "@/lib/capital";

interface AccountOption {
  id: string;
  name: string;
  broker: string;
  archivedAt: string | null;
}

/** Quick account switching; the full Filters panel still supports multiple accounts. */
export function AccountSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { data, error } = useApi<{
    totalCapital: number | null;
    accounts: AccountOption[];
  }>("/api/accounts?summary=1");
  const selected = params.get("accounts")?.split(",").filter(Boolean) ?? [];
  const accounts = data?.accounts.filter((a) => !a.archivedAt || selected.includes(a.id)) ?? [];
  const demo = accounts.find((a) => a.broker === "demo");
  const value = selected.length > 1 ? "multiple" : (selected[0] ?? "all");
  const label =
    selected.length > 1
      ? `${selected.length} accounts`
      : (accounts.find((a) => a.id === selected[0])?.name ??
        (selected.length ? "Selected account" : "All accounts"));
  const basis: CapitalBasis = params.get("capitalBasis") === "allocated" ? "allocated" : "total";
  const showBasis = data?.totalCapital !== null && data?.totalCapital !== undefined;

  async function selectAccount(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("accounts", id === "all" ? "" : id);
    try {
      await saveUiPreference("accountSelection", id === "all" ? [] : [id]);
    } catch {
      publishHeaderNotice("Could not save account selection.");
      return;
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  function selectBasis(next: CapitalBasis) {
    const updated = new URLSearchParams(params.toString());
    if (next === "allocated") updated.set("capitalBasis", next);
    else updated.delete("capitalBasis");
    router.replace(`${pathname}?${updated.toString()}`, { scroll: false });
  }

  return (
    <div className="relative min-w-0 max-w-full">
      <Select value={value} onValueChange={selectAccount}>
        <SelectTrigger
          aria-label="Select account"
          className="h-8 w-44 max-w-full rounded-lg text-xs"
        >
          <WalletCards className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        </SelectTrigger>
        <SelectContent className="rounded-2xl border-white/10 p-1 shadow-2xl" align="end">
          <SelectItem value="all" className="rounded-lg text-xs">
            All accounts
          </SelectItem>
          {selected.length > 1 && (
            <SelectItem value="multiple" disabled className="text-xs">
              {label}
            </SelectItem>
          )}
          {accounts
            .filter((a) => a.broker !== "demo")
            .map((account) => (
              <SelectItem key={account.id} value={account.id} className="rounded-lg text-xs">
                <span className="block max-w-64 truncate">
                  {account.name}
                  {account.archivedAt ? " (archived)" : ""}
                </span>
              </SelectItem>
            ))}
          {demo && (
            <>
              <div className="my-1 border-t" />
              <SelectItem value={demo.id} className="rounded-lg text-xs">
                Demo data
              </SelectItem>
            </>
          )}
          {showBasis && (
            <>
              <div className="my-1 border-t" />
              <div
                role="radiogroup"
                aria-label="Capital basis"
                className="flex items-center gap-1 px-1.5 py-1"
                onClick={(event) => event.stopPropagation()}
              >
                <Landmark className="mr-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="mr-1 text-xs text-muted-foreground">Capital basis</span>
                {(["total", "allocated"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={basis === option}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-xs capitalize transition-colors",
                      basis === option
                        ? "bg-foreground text-background"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => selectBasis(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </>
          )}
        </SelectContent>
      </Select>
      {error && (
        <p role="alert" className="max-w-64 pt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
