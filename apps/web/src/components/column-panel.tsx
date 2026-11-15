"use client";

import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Desktop stays in flow; on mobile the controls open below the visible header. */
export function ColumnPanel({
  panelRef,
  children,
}: {
  panelRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    const header = document.querySelector(".journal-filter-bar");
    if (!header) return;
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () =>
      setTop(
        media.matches
          ? Math.max(
              0,
              header.getBoundingClientRect().bottom,
              document.querySelector(".journal-page-title-sticky")?.getBoundingClientRect()
                .bottom ?? 0,
            )
          : null,
      );
    const observer = new ResizeObserver(update);
    observer.observe(header);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, []);
  const panel = (
    <div
      ref={panelRef}
      className={top === null ? undefined : "mobile-column-panel"}
      style={top === null ? undefined : { top, maxHeight: `calc(100dvh - ${top}px - 12px)` }}
    >
      {children}
    </div>
  );
  return top === null ? panel : createPortal(panel, document.body);
}
