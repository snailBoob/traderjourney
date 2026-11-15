// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const state = vi.hoisted(() => ({
  focusDate: "2026-08-13",
  scrolledTo: [] as number[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(state.focusDate ? `focusDate=${state.focusDate}` : ""),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: () => null,
  useFilters: () => ({ query: "", timeZone: "UTC" }),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: vi.fn(),
  useApi: (url?: string) =>
    url?.startsWith("/api/journal?")
      ? {
          data: {
            days: [
              {
                date: "2026-08-11",
                stats: null,
                hasNote: false,
                dailyBias: [],
                accordingToDailyBias: null,
                hasScreenshots: false,
                sessionDurationMinutes: null,
                routine: { completed: 0, total: 0, score: null, remaining: [] },
              },
              {
                date: "2026-08-12",
                stats: null,
                hasNote: false,
                dailyBias: [],
                accordingToDailyBias: null,
                hasScreenshots: false,
                sessionDurationMinutes: null,
                routine: { completed: 0, total: 0, score: null, remaining: [] },
              },
              {
                date: "2026-08-13",
                stats: null,
                hasNote: false,
                dailyBias: [],
                accordingToDailyBias: null,
                hasScreenshots: false,
                sessionDurationMinutes: null,
                routine: { completed: 0, total: 0, score: null, remaining: [] },
              },
            ],
            pagination: { page: 1, pageSize: 50, total: 3, totalPages: 1, from: 0, to: 3 },
            summary: {
              consecutiveWinningDays: 0,
              consecutiveLosingDays: 0,
              accordingToDailyBias: null,
              routineCompletion: null,
            },
            strategies: [],
            routines: [],
            existingDates: [],
            timeZone: "UTC",
          },
        }
      : { data: undefined },
}));
vi.mock("@/lib/ui-preferences-client", () => ({
  saveUiPreference: vi.fn(),
  useUiPreferences: () => ({ data: undefined }),
}));
vi.mock("@/components/journal-quick-edit-modal", () => ({
  JournalQuickEditModal: () => null,
  ScreenshotGrid: () => null,
}));
vi.mock("@/components/add-trade-dialog", () => ({ AddTradeDialog: () => null }));
vi.mock("@/components/charts/equity-area", () => ({ EquityArea: () => null }));
vi.mock("@/components/rich-editor", () => ({
  RichEditor: () => null,
  Markdown: ({ value }: { value: string }) => createElement("div", null, value),
}));
vi.mock("@/components/ui/date-picker", () => ({ DatePicker: () => null }));
vi.mock("@/components/tag-input", () => ({ TagInput: () => null }));
vi.mock("@/components/routine-day-cell", () => ({ RoutineDayCell: () => null }));
vi.mock("@/components/pnl", () => ({ Pnl: () => null }));
vi.mock("@/components/privacy", () => ({ MonetaryValue: () => null }));
vi.mock("@/components/expanded-trade", () => ({ ExpandedTrade: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ HoverHint: () => null }));
vi.mock("@/components/filter-fields", () => ({ Field: () => null }));
vi.mock("@/components/ui/card", () => ({
  Card: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
  CardContent: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
  CardHeader: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
  CardTitle: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
}));
vi.mock("@/components/ui/skeleton", () => ({ Skeleton: () => null }));
vi.mock("@/components/ui/checkbox", () => ({ Checkbox: () => null }));
vi.mock("@/components/ui/badge", () => ({
  Badge: (p: { children?: React.ReactNode }) => createElement("span", null, p.children),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
  DialogContent: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
  DialogHeader: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
  DialogTitle: (p: { children?: React.ReactNode }) => createElement("div", null, p.children),
}));
vi.mock("@/components/ui/button", () => ({
  Button: (p: { children?: React.ReactNode }) => createElement("button", null, p.children),
}));

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  state.scrolledTo = [];
  window.scrollTo = ((_x: number, y: number) => {
    state.scrolledTo.push(y);
  }) as typeof window.scrollTo;
  // Simulate the focused row resting below the fold; other elements keep jsdom's zero rects.
  const originalRect = Element.prototype.getBoundingClientRect;
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: function (this: Element) {
      if (this.id?.startsWith("journal-day-")) {
        return {
          top: 2251,
          bottom: 2451,
          left: 0,
          right: 1000,
          width: 1000,
          height: 200,
          x: 0,
          y: 2251,
          toJSON: () => ({}),
        } as DOMRect;
      }
      return originalRect.call(this);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // @ts-expect-error restore the real rect implementation
  delete Element.prototype.getBoundingClientRect;
});

it("aligns the focusDate day row just below the sticky filter bar", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { default: JournalPage } = await import("../src/app/journal/page");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(JournalPage));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  const focusedRow = document.getElementById("journal-day-2026-08-13");
  expect(focusedRow).not.toBeNull();
  // The scroll retries run on timers (0–4000ms) to survive table layout and
  // late content, so poll until an attempt scrolls to the row.
  for (let waited = 0; waited < 2500 && state.scrolledTo.length === 0; waited += 100) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  }
  // No sticky bar renders in the mocked page (offset 0): the row's document
  // top must be the scroll target.
  expect(state.scrolledTo).toContain(2251);
  root.unmount();
});
