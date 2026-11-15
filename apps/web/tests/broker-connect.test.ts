// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { listBrokers } from "@luxalgo/broker-sdk";

// Keep hook mock data referentially stable. AccountsPage has an effect that
// depends on `data` and `uiSettings`; fresh objects on every mock call cause
// the effect to set a new empty array repeatedly, preventing the test from
// settling before it reaches the broker dialog.
const accountsResponse = { accounts: [] };
const uiSettingsResponse = { preferences: { accountOrder: [] } };
const uiPreferencesResponse = { data: uiSettingsResponse };

const state = vi.hoisted(() => ({
  post: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  settingsError: null as string | null,
  brokers: [] as unknown[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/ui/tooltip", () => ({
  HoverHint: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/filter-bar", () => ({
  FilterBar: ({ actions, title }: { actions?: ReactNode; title?: string }) =>
    createElement("header", null, createElement("h1", null, title), actions),
}));
vi.mock("@/lib/use-api", () => ({
  postJson: (...args: unknown[]) => state.post(...args),
  useApi: (url: string) => {
    if (url === "/api/accounts") return { data: accountsResponse, refresh: state.refresh };
    if (url === "/api/settings/ui") return { data: uiSettingsResponse };
    return {
      data: state.settingsError
        ? undefined
        : { timeZone: "UTC", importTimeZone: "America/New_York" },
      error: state.settingsError,
      refresh: state.refresh,
    };
  },
}));
vi.mock("@/lib/ui-preferences-client", () => ({
  useUiPreferences: () => uiPreferencesResponse,
  saveUiPreference: vi.fn(),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogContent: ({ children }: { children: ReactNode }) =>
    createElement("section", null, children),
  DialogDescription: ({ children }: { children: ReactNode }) => createElement("p", null, children),
  DialogHeader: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children: ReactNode }) => createElement("h2", null, children),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  }) =>
    createElement("div", { "data-tabs-value": value, "data-tabs-change": onValueChange }, children),
  TabsList: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  TabsTrigger: ({ children, value }: { children: ReactNode; value: string }) =>
    createElement("button", { type: "button", "data-tab": value }, children),
  TabsContent: ({ value, children }: { value: string; children: ReactNode }) =>
    value === "broker" ? createElement("div", null, children) : null,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) =>
    createElement(
      "div",
      null,
      createElement(
        "select",
        {
          value,
          onChange: (event: { target: { value: string } }) => onValueChange(event.target.value),
          "aria-label": "Broker",
        },
        children,
      ),
    ),
  SelectContent: ({ children }: { children: ReactNode }) => children,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
const { default: AccountsPage } = await import("../src/app/accounts/page");
const brokers = listBrokers();
let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.post.mockReset().mockResolvedValue({
    id: "connected-test",
    sync: { inserted: 0, fetched: 0, duplicates: 0, skipped: 0, skippedReasons: [] },
  });
  state.push.mockReset();
  state.refresh.mockReset();
  state.settingsError = null;
  state.brokers = brokers;
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ brokers }) });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("alert", vi.fn());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(AccountsPage)));
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add account"))
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const choose = async (id: string) =>
  act(async () => {
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Broker"]');
    expect(select, "broker selector should be rendered by Add account").toBeTruthy();
    select!.value = id;
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
const fillCredentials = async (broker: (typeof brokers)[number]) =>
  act(async () => {
    const inputs = [...container.querySelectorAll<HTMLInputElement>("input")];
    // The account-name field precedes the credential fields in the current Add account dialog.
    for (const field of broker.credentials) {
      if (/optional/i.test(field.label)) continue;
      const input = inputs.find(
        (candidate) => candidate.type === (field.secret ? "password" : "text") && !candidate.value,
      );
      expect(input, `input for ${field.label} should be present`).toBeTruthy();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, `test-${field.key}`);
      input!.dispatchEvent(new Event("input", { bubbles: true }));
      input!.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
const createButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "Create account",
  );

it("exposes exactly the 22 public brokers including the six added integrations", () => {
  expect(brokers).toHaveLength(22);
  expect(
    [...container.querySelectorAll("option")]
      .map((option) => (option as HTMLOptionElement).value)
      .sort(),
  ).toEqual(brokers.map((broker) => broker.id).sort());
  expect(brokers.map((broker) => broker.id)).toEqual(
    expect.arrayContaining([
      "schwab",
      "tradestation",
      "tastytrade",
      "robinhood-crypto",
      "gemini",
      "kucoin",
    ]),
  );
});
it.each(brokers)(
  "renders and submits $id credentials using the current Add account flow",
  async (broker) => {
    await choose(broker.id);
    expect(container.textContent).toContain(broker.readOnlySetup);
    for (const field of broker.credentials) {
      const input = [...container.querySelectorAll<HTMLInputElement>("input")].find(
        (candidate) => candidate.type === (field.secret ? "password" : "text") && !candidate.value,
      );
      expect(input, field.label).toBeTruthy();
    }
    await fillCredentials(broker);
    const button = createButton();
    expect(button).toBeTruthy();
    expect(button!.disabled).toBe(false);
    await act(async () => button!.click());
    expect(state.post).toHaveBeenCalledWith(
      "/api/accounts",
      expect.objectContaining({
        name: broker.displayName,
        kind: "sync",
        broker: broker.id,
        credentials: expect.objectContaining(
          Object.fromEntries(
            broker.credentials
              .filter((field) => !/optional/i.test(field.label))
              .map((field) => [field.key, `test-${field.key}`]),
          ),
        ),
        initialSync: false,
      }),
    );
    expect(state.post).toHaveBeenCalledWith(`/api/accounts/connected-test/actions`, {
      action: "sync",
    });
  },
);
it("reports broker-load failures in the Add account dialog", async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ error: "Could not load brokers" }, { status: 503 }),
  );
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Cancel"))
      ?.click();
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add account"))
      ?.click();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Could not load brokers");
});

it("keeps a created account when its initial sync fails and refreshes the list", async () => {
  const broker = brokers.find((item) => item.id === "binance")!;
  await choose(broker.id);
  await fillCredentials(broker);
  state.post.mockResolvedValueOnce({ id: "created" }).mockRejectedValueOnce(new Error("Offline"));
  await act(async () => createButton()!.click());
  expect(state.post).toHaveBeenCalledTimes(2);
  expect(state.post).toHaveBeenLastCalledWith("/api/accounts/created/actions", { action: "sync" });
  expect(state.refresh).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("Account created — sync failed");
  expect(container.textContent).toContain("Offline");
  expect(createButton()).toBeUndefined();
});

it("retains the form on creation failure and retries without losing credentials", async () => {
  const broker = brokers.find((item) => item.id === "binance")!;
  await choose(broker.id);
  await fillCredentials(broker);
  state.post.mockRejectedValueOnce(new Error("Creation failed"));
  await act(async () => createButton()!.click());
  expect(container.textContent).toContain("Creation failed");
  expect(state.refresh).not.toHaveBeenCalled();
  expect(createButton()!.disabled).toBe(false);
  const initialRequest = state.post.mock.calls[0];
  await act(async () => createButton()!.click());
  expect(state.post.mock.calls[1]).toEqual(initialRequest);
  expect(state.refresh).toHaveBeenCalledTimes(1);
});

it("clears broker credentials and errors when cancelling and reopening", async () => {
  const broker = brokers.find((item) => item.id === "binance")!;
  await choose(broker.id);
  await fillCredentials(broker);
  state.post.mockRejectedValueOnce(new Error("Creation failed"));
  await act(async () => createButton()!.click());
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Cancel")!
      .click();
  });
  await act(async () => {
    [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add account"))!
      .click();
  });
  await choose(broker.id);
  expect(container.textContent).not.toContain("Creation failed");
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  expect(createButton()!.disabled).toBe(true);
});
