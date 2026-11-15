// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DatePicker } from "../src/components/ui/date-picker";

afterEach(() => vi.unstubAllGlobals());

it("reports invalid typed drafts without silently submitting the previous valid date", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const change = vi.fn();
  const valid = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(DatePicker, {
          label: "Sync start date",
          value: "2026-11-01",
          onValueChange: change,
          onValidityChange: valid,
        }),
      ),
    );
    const input = container.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    const type = async (text: string) =>
      act(async () => {
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("2026-02-30");
    expect(valid).toHaveBeenLastCalledWith(false);
    expect(change).not.toHaveBeenCalled();
    await type("2026-02-28");
    expect(valid).toHaveBeenLastCalledWith(true);
    expect(change).toHaveBeenLastCalledWith("2026-02-28");
    await type("");
    expect(valid).toHaveBeenLastCalledWith(true);
    expect(change).toHaveBeenLastCalledWith("");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
