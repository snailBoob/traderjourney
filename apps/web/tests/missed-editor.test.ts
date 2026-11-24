// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  refreshTags: vi.fn(),
  data: {
    trades: [
      {
        id: "missed-1",
        symbol: "TEST",
        observedAt: "2026-11-01",
        createdAt: "2026-11-01",
        playbookId: "s1",
        outcome: null,
        tradingViewUrl: null,
        notes: "Existing note",
        tags: ["tag"],
        snapshotId: null as string | null,
        ruleReview: { followed: 1, assessed: 1, total: 1 },
        ruleChecks: [{ rule: "First rule", followed: true }],
      },
    ],
  },
  books: {
    playbooks: [
      { id: "s1", name: "First", description: "", rules: ["First rule"] },
      { id: "s2", name: "Second", description: "", rules: ["Second rule"] },
    ],
  },
  suggestions: { tags: ["tag"] },
  preferences: { preferences: {} },
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: ({ primaryAction, actions }: { primaryAction: ReactNode; actions: ReactNode }) =>
    createElement("header", null, actions, primaryAction),
  useFilters: () => ({ query: "", values: {} }),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: (url: string) =>
    url.startsWith("/api/workspace/missed")
      ? { data: state.data, refresh: state.refresh }
      : url === "/api/playbooks"
        ? { data: state.books }
        : { data: state.suggestions, refresh: state.refreshTags },
}));
vi.mock("@/lib/ui-preferences-client", () => ({
  useUiPreferences: () => ({ data: state.preferences }),
  saveUiPreference: vi.fn(),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement("section", { role: "dialog" }, children) : null,
  DialogContent: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
}));
vi.mock("@/components/ui/tooltip", () => ({ HelpHint: () => null }));
vi.mock("@/components/ui/date-picker", () => ({
  DatePicker: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) =>
    createElement("input", {
      "aria-label": "Observation date",
      value,
      onChange: (e: { target: { value: string } }) => onValueChange(e.target.value),
    }),
}));
vi.mock("@/components/ui/option-select", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      "select",
      { value, onChange: (e: { target: { value: string } }) => onValueChange(e.target.value) },
      children,
    ),
}));
vi.mock("@/components/rich-editor", () => ({
  Markdown: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  RichEditor: ({
    value,
    onChange,
    editorRef,
  }: {
    value: string;
    onChange: (value: string) => void;
    editorRef: { current: unknown };
  }) =>
    createElement("textarea", {
      "aria-label": "Note",
      value,
      ref: (node: HTMLTextAreaElement | null) => {
        editorRef.current = node ? { focus: () => node.focus() } : null;
      },
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
}));
vi.mock("@/components/tag-input", () => ({ TagInput: () => null }));
const { default: MissedPage } = await import("../src/app/missed/page");
let container: HTMLDivElement;
let root: Root;
const button = (name: string) => {
  const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === name,
  );
  expect(result, name).toBeTruthy();
  return result!;
};
const click = async (name: string) => act(async () => button(name).click());
const edit = async () => {
  await act(async () => (container.querySelector(".desktop-entry-row") as HTMLElement).click());
  await click("Edit");
};
beforeEach(async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((media: string) => ({ matches: false, media })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset().mockResolvedValue({ id: "missed-1" });
  state.refresh.mockReset();
  state.refreshTags.mockReset();
  state.data.trades[0]!.snapshotId = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(MissedPage)));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await act(async () => root.unmount());
  container.remove();
});

it("preserves the existing fields on save, refreshes tags and list, and keeps details expanded", async () => {
  await edit();
  await click("Save");
  expect(state.post).toHaveBeenCalledWith(
    "/api/workspace/missed",
    expect.objectContaining({
      id: "missed-1",
      symbol: "TEST",
      notes: "Existing note",
      tags: ["tag"],
      ruleChecks: [{ rule: "First rule", followed: true }],
    }),
  );
  expect(state.refresh).toHaveBeenCalledTimes(1);
  expect(state.refreshTags).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(button("Edit")).toBeTruthy();
});
it("retains the draft after a save error and permits retry", async () => {
  await edit();
  state.post.mockRejectedValueOnce(new Error("Offline"));
  await click("Save");
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Offline");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Existing note");
  expect(state.refresh).not.toHaveBeenCalled();
  await click("Save");
  expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0]);
});
it("shows a replacement snapshot in the open detail and fullscreen after saving", async () => {
  state.data.trades[0]!.snapshotId = "original";
  state.refresh.mockImplementationOnce(() => {
    state.data.trades[0]!.snapshotId = "replacement";
  });
  await edit();
  const preview = () => container.querySelector('img[alt="TradingView snapshot"]');
  expect(preview()?.getAttribute("src")).toBe("/api/snapshots/missed/missed-1?v=original");
  await click("Save");
  const updatedSrc = "/api/snapshots/missed/missed-1?v=replacement";
  expect(preview()?.getAttribute("src")).toBe(updatedSrc);
  await act(async () => preview()?.closest("button")?.click());
  expect(
    container.querySelector('img[alt="TradingView snapshot fullscreen"]')?.getAttribute("src"),
  ).toBe(updatedSrc);
});
it("resets rule assessments when changing strategy", async () => {
  await edit();
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('[role="dialog"] select')!;
    select.value = "s2";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("Save");
  expect(state.post).toHaveBeenCalledWith(
    "/api/workspace/missed",
    expect.objectContaining({
      playbookId: "s2",
      ruleChecks: [{ rule: "Second rule", followed: null }],
    }),
  );
});
it("cancels without saving and opens a fresh draft next time", async () => {
  await edit();
  await click("Cancel");
  await click("Add missed trade");
  expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
  expect(button("Save").disabled).toBe(true);
  expect(state.post).not.toHaveBeenCalled();
});
