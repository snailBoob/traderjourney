"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { EntryTableContext } from "./adaptive-entry-table";

export interface EntryField {
  id: string;
  label: string;
  value: ReactNode;
  onSort?: () => void;
}

/** Rows report intrinsic widths; the table supplies one shared column layout. */
export function AdaptiveEntryRow({
  fields,
  expanded,
  onToggle,
  indicator,
  id,
  afterExpanded = false,
}: {
  id?: string;
  fields: EntryField[];
  expanded: boolean;
  onToggle: () => void;
  indicator?: ReactNode;
  afterExpanded?: boolean;
}) {
  const measure = useRef<HTMLDivElement>(null);
  const measurementId = useId();
  const { count, widths, report } = useContext(EntryTableContext);
  useLayoutEffect(() => () => report(measurementId, null), [measurementId, report]);
  useLayoutEffect(() => {
    const rail = measure.current;
    if (!rail) return;
    const update = () => {
      if (!rail.getClientRects().length) return;
      report(
        measurementId,
        Object.fromEntries(
          Array.from(rail.children, (child, index) => [
            fields[index]!.id,
            child.getBoundingClientRect().width,
          ]),
        ),
      );
    };
    const observer = new ResizeObserver(update);
    for (const child of rail.children) observer.observe(child);
    update();
    return () => observer.disconnect();
  }, [fields, report, measurementId]);
  return (
    <tr id={id} className={`adaptive-entry-row ${afterExpanded ? "entry-after-expanded" : ""}`}>
      <td>
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
            <div ref={measure} className="adaptive-entry-measure" aria-hidden="true" inert>
              {fields.map((field) => (
                <div key={field.id} className="adaptive-entry-field">
                  <span className="adaptive-entry-label">{field.label}</span>
                  <div>{field.value}</div>
                </div>
              ))}
            </div>
            {fields.slice(0, count).map((field) => (
              <div key={field.id} className="adaptive-entry-field" data-field={field.id}>
                <div onClick={onToggle}>{field.value}</div>
              </div>
            ))}
            {count === 0 && (
              <button className="min-h-11 text-sm" onClick={onToggle}>
                View entry
              </button>
            )}
          </div>
          <button
            type="button"
            className="adaptive-entry-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse entry" : "Expand entry"}
          >
            {indicator}
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        </div>
        {expanded && (
          <dl className="adaptive-entry-all-fields">
            {fields.map((field) => (
              <div key={field.id}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </td>
    </tr>
  );
}
