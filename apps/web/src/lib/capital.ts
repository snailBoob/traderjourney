/** Lens for balance-relative stats: whole pot vs what accounts hold. */
export type CapitalBasis = "total" | "allocated";

export const readCapitalBasis = (value: string | null | undefined): CapitalBasis =>
  value === "allocated" ? "allocated" : "total";

/**
 * Denominator for drawdown % and related stats.
 * Without a total-capital setting both lenses fall back to the allocated sum,
 * which is the pre-feature behavior.
 */
export const effectiveCapitalBase = ({
  basis,
  totalCapital,
  allocatedBalance,
}: {
  basis: CapitalBasis;
  totalCapital: number | null;
  allocatedBalance: number;
}): number => (basis === "allocated" || totalCapital === null ? allocatedBalance : totalCapital);
