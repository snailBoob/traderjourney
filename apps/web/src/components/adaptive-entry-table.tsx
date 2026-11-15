"use client";

import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { fittingEntryCount, widestEntryColumns } from "@/lib/fitting-entry-count";

export interface EntryColumn {
  id: string;
  label: string;
  onSort?: () => void;
}

export const EntryTableContext = createContext({
  count: 0,
  widths: [] as number[],
  report: (_id: string, _widths: Record<string, number> | null) => {},
});

/** One measured column layout for the entire rendered page, including collapsed rows. */
export function AdaptiveEntryTable({
  columns,
  children,
  ...props
}: ComponentProps<"table"> & { columns: EntryColumn[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [measurements, setMeasurements] = useState<Record<string, Record<string, number>>>({});
  const report = useCallback((id: string, values: Record<string, number> | null) => {
    setMeasurements((current) => {
      if (values === null) {
        if (!(id in current)) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      const previous = current[id];
      if (
        previous &&
        Object.keys(previous).length === Object.keys(values).length &&
        Object.entries(values).every(([key, value]) => previous[key] === value)
      )
        return current;
      return { ...current, [id]: values };
    });
  }, []);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    // Same horizontal padding, gap and toggle width as the mobile row.
    const update = () => setAvailable(Math.max(0, element.clientWidth - 64));
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const widths = widestEntryColumns(
    columns.map((column) => column.id),
    Object.values(measurements),
  );
  const count = fittingEntryCount(widths, available);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const expanded = element.querySelector('[aria-expanded="true"]');
    if (!expanded) element.style.minHeight = "";
  });
  const heading = (
    <tr className="adaptive-entry-heading" key="mobile-heading">
      <th>
        <div className="adaptive-entry-summary">
          <div
            className="adaptive-entry-fields"
            style={{
              gridTemplateColumns: widths
                .slice(0, count)
                .map((width) => `${width}px`)
                .join(" "),
            }}
          >
            {columns.slice(0, count).map((column) => (
              <div key={column.id} className="adaptive-entry-column-label" data-column={column.id}>
                {column.onSort ? (
                  <button
                    type="button"
                    className="adaptive-entry-label"
                    onClick={column.onSort}
                    aria-label={`Sort by ${column.label}`}
                  >
                    {column.label}
                  </button>
                ) : (
                  <span className="adaptive-entry-label">{column.label}</span>
                )}
              </div>
            ))}
          </div>
          <span className="adaptive-entry-toggle" aria-hidden="true" />
        </div>
      </th>
    </tr>
  );
  return (
    <EntryTableContext.Provider value={{ count, widths, report }}>
      <div
        ref={root}
        className="min-w-0"
        onClickCapture={(event) => {
          const element = root.current;
          const target = event.target as HTMLElement;
          if (
            !element ||
            !window.matchMedia("(max-width: 1023px)").matches ||
            !target.closest(".adaptive-entry-row")
          )
            return;
          // Reserve only the visible remainder of the viewport before hiding rows.
          // Short/loading details must not reduce the document below its current scroll position.
          const minimumHeight = Math.max(
            0,
            window.innerHeight - element.getBoundingClientRect().top,
          );
          element.style.minHeight = `${minimumHeight}px`;
        }}
      >
        <table {...props}>
          {Children.map(children, (child) =>
            isValidElement<{ children?: ReactNode }>(child) && child.type === "thead"
              ? cloneElement(child, {}, heading, child.props.children)
              : child,
          )}
        </table>
      </div>
    </EntryTableContext.Provider>
  );
}
