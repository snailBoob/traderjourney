const releasesUrl = "https://github.com/snailBoob/traderjourney/releases";

export function stableVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(value);
  return match?.[1] ?? null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const next = stableVersion(candidate)?.split(".").map(Number);
  const installed = stableVersion(current)?.split(".").map(Number);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== installed[i]) return next[i]! > installed[i]!;
  }
  return false;
}

export function releaseUrl(version: string): string {
  const stable = stableVersion(version);
  return stable ? `${releasesUrl}/tag/v${stable}` : releasesUrl;
}
