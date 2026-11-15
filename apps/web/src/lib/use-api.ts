"use client";

import { startTransition, useCallback, useEffect, useState } from "react";
import { acquireJson } from "./api-request";
import { requestJson } from "./request-json";

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Deduplicate concurrent reads and cancel requests when their last consumer leaves. */
export const useApi = <T>(url: string | null): ApiState<T> => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [tick, setTick] = useState(0);
  const [dataUrl, setDataUrl] = useState(url);

  useEffect(() => {
    const refreshAfterSync = () => setTick((value) => value + 1);
    window.addEventListener("tj:api-refresh", refreshAfterSync);
    return () => window.removeEventListener("tj:api-refresh", refreshAfterSync);
  }, []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const request = acquireJson<T>(url);
    request.promise
      .then((body) => {
        if (cancelled) return;
        // Render fresh data as a transition so React yields to the browser mid-render
        // instead of blocking the main thread for the whole page.
        startTransition(() => {
          setData(body);
          setDataUrl(url);
          setError(null);
          setLoading(false);
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Network error");
          setData(null);
          setDataUrl(url);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      request.release();
    };
  }, [url, tick]);

  // Excursion backfills finish after the response. Only pending calculations
  // poll; completed results and unavailable history do not keep refetching.
  const excursionsPending = Boolean(
    data && typeof data === "object" && "excursionsPending" in data && data.excursionsPending,
  );
  useEffect(() => {
    if (!excursionsPending) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), 3000);
    return () => window.clearTimeout(timer);
  }, [excursionsPending, data, url]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  const current = dataUrl === url;
  return {
    data: current ? data : null,
    error: current ? error : null,
    loading: Boolean(url) && (!current || loading),
    refresh,
  };
};

export const postJson = async <T = unknown>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "PUT" | "DELETE" = "POST",
): Promise<T> => {
  return requestJson<T>(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};
