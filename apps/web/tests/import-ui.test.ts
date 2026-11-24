// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "../src/components/ui/tooltip";
const state = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/filter-bar", () => ({ FilterBar: () => null }));
vi.mock("@/components/manual-trade-entry", () => ({ ManualTradeEntry: () => null }));
vi.mock("@/components/import-reconciliation", () => ({ ImportReconciliation: () => null }));
vi.mock("@/components/timezone-picker", () => ({ TimeZonePicker: () => null }));
vi.mock("@/components/account-picker", () => ({
  AccountPicker: ({ onChange }: { onChange: (id: string) => void }) =>
    createElement("button", { onClick: () => onChange("test-account") }, "Choose test account"),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: (url: string) => ({
    data:
      url === "/api/settings"
        ? {
            timeZone: "UTC",
            importTimeZone: "UTC",
          }
        : { formats: [] },
  }),
}));
const { default: ImportPage } = await import("../src/app/import/page");
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset();
  state.push.mockReset();
  vi.spyOn(window, "alert").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const render = () =>
  act(async () => root.render(createElement(TooltipProvider, null, createElement(ImportPage))));
const button = (name: string) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent === name,
  )!;
const upload = () =>
  act(async () => {
    const input = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".csv"]')!;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        {
          name: "sample.csv",
          size: 10,
          arrayBuffer: async () => new TextEncoder().encode("statement").buffer,
        },
      ],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
it("previews a statement and requires an account before committing", async () => {
  state.post.mockResolvedValueOnce({
    detected: "generic",
    timeZone: "UTC",
    executions: [
      {
        symbol: "TEST",
        side: "buy",
        quantity: 2,
        price: 100,
        fee: 0,
        executedAt: "2026-09-01T10:00:00Z",
      },
    ],
    totals: {
      executions: 1,
      symbols: 1,
      skippedRows: 0,
      from: "2026-09-01T10:00:00Z",
      to: "2026-09-01T10:00:00Z",
    },
  });
  await render();
  await upload();
  expect(state.post.mock.calls[0]![1]).toMatchObject({
    mode: "preview",
    timeZone: "UTC",
    content: "statement",
  });
  expect(state.post.mock.calls[0]![1]).not.toHaveProperty("ai");
  expect(container.textContent).toContain("TEST · BUY");
  expect(button("Import").disabled).toBe(true);
  await act(async () => button("Choose test account").click());
  expect(button("Import").disabled).toBe(false);
  state.post.mockResolvedValueOnce({ inserted: 1, duplicates: 0 });
  await act(async () => button("Import").click());
  expect(state.post.mock.calls[1]![1]).toMatchObject({
    mode: "commit",
    accountId: "test-account",
    timeZone: "UTC",
  });
  expect(state.post.mock.calls[1]![1]).not.toHaveProperty("ai");
});
