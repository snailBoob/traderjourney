// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

const data = [
  { date: "2026-08-11", netPnl: 100 },
  { date: "2026-08-12", netPnl: 200 },
  { date: "2026-08-13", netPnl: 300 },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  push.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
      constructor(
        callback: (entries: Array<{ contentRect: { width: number; height: number } }>) => void,
      ) {
        this.callback = callback;
      }
      observe() {
        this.callback([{ contentRect: { width: 800, height: 240 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function renderChart() {
  container = document.createElement("div");
  document.body.appendChild(container);
  const { DailyBars } = await import("../src/components/charts/daily-bars");
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(DailyBars, { data }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return container;
}

it("opens the journal for the hovered day when the cursor column is clicked", async () => {
  const wrapper = await renderChart();
  const surface = wrapper.querySelector(".recharts-surface") as SVGSVGElement | null;
  expect(surface).not.toBeNull();

  // A point in the first day's column above the bar: cursor area, not a bar rectangle.
  const eventInit = { bubbles: true, cancelable: true, clientX: 150, clientY: 20, button: 0 };
  // Recharts resolves the hovered day from the mousemove asynchronously (rAF
  // middleware), so let the tooltip state settle before the click.
  await act(async () => {
    surface!.dispatchEvent(new MouseEvent("mousemove", eventInit));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await act(async () => {
    surface!.dispatchEvent(new MouseEvent("click", eventInit));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(push).toHaveBeenCalledWith("/journal?focusDate=2026-08-11");
});

it("does not navigate when the click lands outside any day column", async () => {
  const wrapper = await renderChart();
  const surface = wrapper.querySelector(".recharts-surface") as SVGSVGElement | null;
  expect(surface).not.toBeNull();

  const eventInit = { bubbles: true, cancelable: true, clientX: 4000, clientY: 20, button: 0 };
  await act(async () => {
    surface!.dispatchEvent(new MouseEvent("mousemove", eventInit));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await act(async () => {
    surface!.dispatchEvent(new MouseEvent("click", eventInit));
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  expect(push).not.toHaveBeenCalled();
});
