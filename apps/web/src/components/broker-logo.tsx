"use client";

import { useState } from "react";
import sources from "../../public/brokers/sources.json";
import { brokerDetails } from "@/lib/brokers";

const logos: Record<string, { file: string }> = sources;

export function BrokerLogo({ broker }: { broker: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const name = brokerDetails(broker).name;
  const file = logos[broker]?.file;
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-white text-xs font-semibold text-slate-800"
      aria-hidden="true"
    >
      {file && failed !== broker ? (
        <img
          src={`/brokers/${file}`}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 object-contain"
          onError={() => setFailed(broker)}
        />
      ) : (
        name.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
