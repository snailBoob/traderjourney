// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { snapshotDashboardCard } from "../src/components/dashboard-motion";

afterEach(() => vi.unstubAllGlobals());

it("creates distinct SVG references when dragging over HTTP without randomUUID", () => {
  vi.stubGlobal("crypto", {});
  const surface = document.createElement("div");
  surface.innerHTML =
    '<svg><defs><clipPath id="chart-clip"></clipPath></defs><g clip-path="url(#chart-clip)"></g></svg>';
  const first = snapshotDashboardCard(surface, new Event("keydown"));
  const second = snapshotDashboardCard(surface, new Event("keydown"));
  const firstId = first.element.querySelector("[id]")!.id;
  const secondId = second.element.querySelector("[id]")!.id;
  expect(firstId).not.toBe(secondId);
  expect(firstId).not.toBe("chart-clip");
  expect(first.element.querySelector("g")!.getAttribute("clip-path")).toBe(`url(#${firstId})`);
  expect(surface.querySelector("[id]")!.id).toBe("chart-clip");
});
