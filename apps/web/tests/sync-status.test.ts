// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { runSync, useSyncStatus, setSyncFailure } from "../src/lib/sync-status";

it("keeps sync active across remounts, rejects duplicate starts and refreshes on completion", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const View = () => createElement("span", null, useSyncStatus().syncing ? "Syncing" : "Idle");
  let root = createRoot(container);
  await act(async () => root.render(createElement(View)));
  let finish!: () => void;
  let running!: Promise<void>;
  const refresh = vi.fn();
  window.addEventListener("tj:api-refresh", refresh);
  await act(async () => {
    running = runSync(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  });
  expect(container.textContent).toBe("Syncing");
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(View)));
  expect(container.textContent).toBe("Syncing");
  const duplicate = vi.fn();
  await runSync(duplicate);
  expect(duplicate).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    await running;
  });
  expect(container.textContent).toBe("Idle");
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  window.removeEventListener("tj:api-refresh", refresh);
});

it("retains failures for the newly mounted page and allows retry", async () => {
  await runSync(async () => {
    throw new Error("Broker unavailable");
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const View = () => createElement("span", null, useSyncStatus().syncFailure?.summary);
  await act(async () => root.render(createElement(View)));
  expect(container.textContent).toBe("Broker unavailable");
  const retry = vi.fn().mockResolvedValue(undefined);
  await act(async () => runSync(retry));
  expect(retry).toHaveBeenCalledOnce();
  expect(container.textContent).toBe("");
  await act(async () => {
    setSyncFailure(null);
    root.unmount();
  });
});
