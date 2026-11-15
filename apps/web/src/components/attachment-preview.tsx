"use client";

import { useEffect, useState } from "react";

export function AttachmentPreview({
  src,
  name,
  mime,
  onClose,
}: {
  src: string;
  name: string;
  mime: string;
  onClose: () => void;
}) {
  const [pdfUrl, setPdfUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (mime !== "application/pdf") return;
    const controller = new AbortController();
    let objectUrl = "";
    void fetch(src, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load preview.");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not load preview.");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, mime]);

  if (error) return <p role="alert">{error}</p>;
  if (mime === "application/pdf") {
    return pdfUrl ? (
      <iframe src={pdfUrl} title={name} className="h-[70dvh] w-full rounded" />
    ) : (
      <p role="status">Loading preview…</p>
    );
  }
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close image preview"
      className="min-w-0 cursor-zoom-out rounded focus-visible:outline focus-visible:outline-ring"
    >
      <img src={src} alt={name} className="mx-auto max-h-[75dvh] max-w-full object-contain" />
    </button>
  );
}
