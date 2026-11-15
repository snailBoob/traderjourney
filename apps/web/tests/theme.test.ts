import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { THEME_INIT_SCRIPT, THEME_KEY, themePreference } from "../src/lib/theme";

describe("journal appearance", () => {
  it("defaults to system and accepts explicit system, light or dark choices", () => {
    expect(themePreference(null)).toBe("system");
    expect(themePreference("system")).toBe("system");
    expect(themePreference("invalid")).toBe("system");
    expect(themePreference("dark")).toBe("dark");
    expect(themePreference("light")).toBe("light");
  });
  it.each([null, "dark", "light", "invalid"])("applies %s before hydration", (saved) => {
    const calls: unknown[] = [];
    runInNewContext(THEME_INIT_SCRIPT, {
      localStorage: {
        getItem: (key: string) => {
          expect(key).toBe(THEME_KEY);
          return saved;
        },
      },
      window: { matchMedia: () => ({ matches: true }) },
      document: {
        documentElement: { classList: { toggle: (...args: unknown[]) => calls.push(args) } },
      },
    });
    const preference = themePreference(saved);
    expect(calls).toEqual([["dark", preference === "dark" || preference === "system"]]);
  });
  it("uses the system dark preference when browser storage is blocked", () => {
    let dark = false;
    runInNewContext(THEME_INIT_SCRIPT, {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      window: { matchMedia: () => ({ matches: true }) },
      document: {
        documentElement: {
          classList: {
            toggle: (_: string, value: boolean) => {
              dark = value;
            },
          },
        },
      },
    });
    expect(dark).toBe(true);
  });
});
