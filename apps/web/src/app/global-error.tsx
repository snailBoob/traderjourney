"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/client-errors";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportClientError(error, "render");
  }, [error]);
  return (
    <html lang="en">
      <body>
        <h1>TraderJourney could not display this page.</h1>
        <p>Please try again. If the problem continues, check the application logs.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
