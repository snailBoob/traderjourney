import { isNewerVersion, stableVersion } from "@/lib/app-release";
import { version } from "./version";

// Per server process. Share concurrent requests and cache failures as well as successes.
let cached: { expiresAt: number; result: Promise<string | null> } | undefined;
export async function availableUpdate(): Promise<string | null> {
  if (!cached || cached.expiresAt <= Date.now()) {
    cached = { expiresAt: Date.now() + 60 * 60 * 1000, result: latestRelease() };
  }
  const latest = await cached.result;
  return latest && isNewerVersion(latest, version) ? latest : null;
}

async function latestRelease(): Promise<string | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/snailBoob/traderjourney/releases/latest",
      {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.draft !== false || data.prerelease !== false) return null;
    return stableVersion(data.tag_name);
  } catch {
    // Update discovery is best-effort; the installed app remains usable offline.
    return null;
  }
}
