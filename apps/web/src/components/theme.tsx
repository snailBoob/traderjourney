"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { themePreference, THEME_KEY, type Theme } from "@/lib/theme";
import { Button } from "./ui/button";

const ThemeContext = createContext({
  theme: "system" as Theme,
  ready: false,
  setTheme: (_theme: Theme) => {},
});

const themeOptions: { value: Theme; label: string; icon: typeof Monitor }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function resolvedDark(theme: Theme): boolean {
  return (
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const apply = (next: Theme) => {
    document.documentElement.classList.toggle("dark", resolvedDark(next));
    setThemeState(next);
  };

  useEffect(() => {
    let stored: Theme = "system";
    try {
      stored = themePreference(localStorage.getItem(THEME_KEY));
      if (localStorage.getItem(THEME_KEY) === null) localStorage.setItem(THEME_KEY, "system");
    } catch {
      stored = "system";
    }
    apply(stored);
    setReady(true);

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = () => {
      if (stored === "system") apply("system");
    };
    const sync = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) {
        const next = themePreference(event.newValue);
        stored = next;
        apply(next);
        setError("");
      }
    };
    media.addEventListener("change", handleSystemChange);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", handleSystemChange);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const selectTheme = (next: Theme) => {
    apply(next);
    try {
      localStorage.setItem(THEME_KEY, next);
      setError("");
    } catch {
      setError("Appearance changed, but your browser could not save it for next time.");
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, ready, setTheme: selectTheme }}>
      {children}
      {error && (
        <p
          role="status"
          className="fixed bottom-4 right-4 z-50 max-w-[calc(100vw-32px)] rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
        >
          {error}
        </p>
      )}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle({ iconOnly = false }: { iconOnly?: boolean }) {
  const { theme, ready, setTheme } = useContext(ThemeContext);
  const currentIndex = Math.max(
    0,
    themeOptions.findIndex((option) => option.value === theme),
  );
  const current = themeOptions[currentIndex]!;
  const CurrentIcon = current.icon;

  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? "icon" : "sm"}
      className={
        iconOnly
          ? "h-9 w-9 shrink-0 rounded-lg"
          : "w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
      }
      disabled={!ready}
      aria-label={`Theme: ${current.label}`}
      title={iconOnly ? `Theme: ${current.label}` : undefined}
      onClick={() => setTheme(themeOptions[(currentIndex + 1) % themeOptions.length]!.value)}
    >
      <CurrentIcon aria-hidden="true" />
      {!iconOnly && <span>{current.label}</span>}
    </Button>
  );
}
