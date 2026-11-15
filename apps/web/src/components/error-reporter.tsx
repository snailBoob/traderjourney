"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";

export function ErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportClientError(event.error);
    const onRejection = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof Error && event.reason.name === "AbortError") return;
      reportClientError(event.reason, "rejection");
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
