"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { isNewerVersion, releaseUrl } from "@/lib/app-release";

export function AppVersion() {
  const current = process.env.NEXT_PUBLIC_APP_VERSION ?? "unknown";
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch("/api/app-update");
        if (!response.ok) return;
        const data = await response.json();
        if (active)
          setLatest(
            typeof data.version === "string" && isNewerVersion(data.version, current)
              ? data.version
              : null,
          );
      } catch {
        /* Update discovery must not interrupt the journal. */
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [current]);
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span>Open source ·</span>
      <a
        href={releaseUrl(current)}
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
        aria-label={`View release v${current} on GitHub`}
      >
        v{current}
      </a>
      {latest && (
        <a
          href={releaseUrl(latest)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          aria-label={`Update available: v${latest}`}
        >
          <ArrowUp className="h-3 w-3" aria-hidden="true" />v{latest}
        </a>
      )}
    </div>
  );
}
