// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewContext } from "../src/lib/ai-review";
const state = vi.hoisted(() => ({
  filters: { entries: "30" },
  urls: [] as string[],
  post: vi.fn(),
  refresh: vi.fn(),
  data: null as ReviewContext | null,
  loading: false,
}));
vi.mock("@/components/filter-bar", () => ({
  useFilters: () => ({ values: state.filters, timeZone: "UTC" }),
}));
vi.mock("@/components/privacy", () => ({
  MonetaryValue: ({ children }: { children: unknown }) => children,
}));
vi.mock("@/lib/use-api", () => ({
  useApi: (url: string) => {
    state.urls.push(url);
    return { data: state.data, loading: state.loading, error: null, refresh: state.refresh };
  },
  postJson: (...args: unknown[]) => state.post(...args),
}));
const { JournalReview } = await import("../src/components/journal-review");
let root: Root, container: HTMLDivElement;
const render = () => act(async () => root.render(createElement(JournalReview)));
const click = (name: string) =>
  act(async () => {
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === name);
    expect(button).toBeTruthy();
    button!.click();
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  state.filters = { entries: "30" };
  state.urls = [];
  state.loading = false;
  state.post.mockReset();
  const period = {
    count: 30,
    from: "2026-10-01",
    to: "2026-10-30",
    currencies: ["USD"],
    metrics: null,
  };
  state.data = {
    compare: false,
    id: "context1",
    label: "Latest 30",
    comparison: "Previous 30",
    current: period,
    previous: period,
    notes: [],
    sources: [{ id: "current", title: "Current selection", text: "Evidence", href: "" }],
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("starts a scoped review, renders formatted content and opens cited evidence", async () => {
  state.post.mockResolvedValue({
    answer:
      "## Findings\n**Evidence** [source](#review-current) [untrusted](https://external.example)",
  });
  await render();
  await click("Start review");
  expect(state.post.mock.calls[0]![1]).toMatchObject({
    contextId: "context1",
    filters: { lastTrades: "30" },
    noteIds: [],
    history: [],
  });
  expect(container.querySelector("h2")?.textContent).toBe("Findings");
  expect(container.querySelector('a[href="https://external.example"]')).toBeNull();
  await act(async () =>
    (container.querySelector('a[href="#review-current"]') as HTMLAnchorElement).click(),
  );
  expect(container.querySelector("#review-current")?.closest("details")?.open).toBe(true);
  expect(container.querySelector('input[aria-label="Ask about this review"]')).not.toBeNull();
});
it("discards a pending answer after the selection changes", async () => {
  let resolve!: (value: unknown) => void;
  state.post.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  await render();
  await click("Start review");
  state.filters = { entries: "10" };
  state.data = { ...state.data!, id: "context2" };
  await render();
  await act(async () => resolve({ answer: "STALE ANSWER" }));
  expect(container.textContent).not.toContain("STALE ANSWER");
  expect(container.textContent).toContain("Start review");
});
it("allows retry and resets conversation when refreshed source content changes", async () => {
  state.post
    .mockRejectedValueOnce(new Error("Provider unavailable"))
    .mockResolvedValueOnce({ answer: "Review content" });
  await render();
  await click("Start review");
  expect(container.textContent).toContain("Provider unavailable");
  await click("Try again");
  expect(container.textContent).toContain("Review content");
  state.data = { ...state.data!, id: "changed" };
  await render();
  expect(container.textContent).not.toContain("Review content");
});
it("hides previous selection by default and fetches it only after opting in", async () => {
  await render();
  expect(container.textContent).not.toContain("Previous selection ·");
  expect(state.urls.at(-1)).toContain("compare=false");
  await act(async () =>
    (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
  );
  expect(state.urls.at(-1)).toContain("compare=true");
  state.data = { ...state.data!, compare: true, id: "comparison" };
  await render();
  expect(container.textContent).toContain("Previous selection ·");
});
it("collapses only AI responses, preserving totals and conversation, and opens new answers", async () => {
  state.post.mockResolvedValue({ answer: "## Findings\nReview evidence" });
  await render();
  await click("Start review");
  await click("Collapse AI responses");
  const answer = container.querySelector("h2")!.closest("[hidden]");
  expect(answer).not.toBeNull();
  expect(container.textContent).toContain("Current selection · 30 closed trades");
  expect(container.querySelector("h3")!.closest("[hidden]")).toBeNull();
  expect(container.textContent).toContain("Net P&L");
  expect(state.post).toHaveBeenCalledTimes(1);
  await click("Expand AI responses");
  expect(container.querySelector("h2")!.closest("[hidden]")).toBeNull();
  expect(state.post).toHaveBeenCalledTimes(1);
  await click("Collapse AI responses");
  const input = container.querySelector(
    'input[aria-label="Ask about this review"]',
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "Explain this",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Ask");
  expect(container.querySelector("h2")!.closest("[hidden]")).toBeNull();
  expect(state.post.mock.calls[1]![1].history).toHaveLength(2);
});
it("keeps comparison enabled across filter changes while resetting the conversation", async () => {
  state.post.mockResolvedValue({ answer: "Old selection answer" });
  await render();
  await act(async () =>
    (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(),
  );
  state.data = { ...state.data!, compare: true, id: "comparison" };
  await render();
  await click("Start review");
  state.filters = { entries: "10" };
  state.data = { ...state.data!, id: "changed-selection" };
  await render();
  expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(
    true,
  );
  expect(state.urls.at(-1)).toContain("compare=true");
  expect(container.textContent).not.toContain("Old selection answer");
});
it("waits for fresh sources before starting and refreshes a new review without generating", async () => {
  state.post.mockResolvedValue({ answer: "Fresh answer" });
  await render();
  state.loading = true;
  await click("Start review");
  expect(state.urls.at(-1)).toContain("_refresh=1");
  expect(state.post).not.toHaveBeenCalled();
  state.data = { ...state.data!, id: "fresh-context" };
  state.loading = false;
  await render();
  expect(state.post.mock.calls[0]![1].contextId).toBe("fresh-context");
  await click("New review");
  expect(state.urls.at(-1)).toContain("_refresh=2");
  expect(state.post).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Fresh answer");
  expect(container.textContent).not.toContain("Refresh sources");
});
