"use client";
import { AppVersion } from "./app-version";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { FILTER_KEYS } from "@traderjourney/core";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  BookText,
  CalendarDays,
  ArrowLeftRight,
  LayoutDashboard,
  ListOrdered,
  GripVertical,
  LogOut,
  NotebookPen,
  Settings,
  ListChecks,
  BookmarkPlus,
  Wallet,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { postJson, useApi } from "@/lib/use-api";
import { BrandLogo } from "@/components/brand-logo";
import { subscribeHeaderNotice } from "@/lib/header-notice";
import { PrivacyToggle } from "./privacy";
import { ThemeToggle } from "./theme";
import { PageTransition } from "./page-transition";
import { Button } from "./ui/button";
import { HoverHint } from "./ui/tooltip";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/journal", label: "Daily journal", icon: NotebookPen },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/notebook", label: "Notebook", icon: BookText },
  { href: "/strategies", label: "Strategies", icon: BookOpen },
  { href: "/routines", label: "Routines", icon: ListChecks },
  { href: "/missed", label: "Missed trades", icon: BookmarkPlus },
] as const;

const NAV_SETUP = [
  { href: "/import", label: "Import/Export", icon: ArrowLeftRight },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const SIDEBAR_COLLAPSED_KEY = "journal-sidebar-collapsed-v1";
const NAV_ORDER_KEY = "journal-sidebar-nav-order-v1";

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed = false,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed?: boolean;
}) {
  return (
    <HoverHint content={collapsed ? label : null} side="right">
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "journal-sidebar-nav-link relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
          active
            ? "bg-accent font-medium text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )}
      >
        <Icon className={cn("h-4 w-4", active && "text-brand")} />
        <span className="journal-sidebar-label">{label}</span>
      </Link>
    </HoverHint>
  );
}

function SortableNavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed = false,
  reorderMode,
  onNavigate,
  sortableId,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed?: boolean;
  reorderMode: boolean;
  onNavigate?(): void;
  sortableId: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });
  const linkClassName = cn(
    "journal-sidebar-nav-link relative flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
    reorderMode
      ? "select-none cursor-default text-muted-foreground"
      : active
        ? "bg-accent font-medium text-accent-foreground"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );
  const content = (
    <>
      {reorderMode ? (
        <button
          type="button"
          className="touch-none flex h-4 w-4 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
          aria-label={`Reorder ${label}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : (
        <Icon className={cn("h-4 w-4", active && "text-brand")} />
      )}
      <span className="journal-sidebar-label">{label}</span>
    </>
  );

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative min-w-0", isDragging && "z-10 opacity-70")}
    >
      <HoverHint content={collapsed ? label : null} side="right">
        {reorderMode ? (
          <div aria-disabled="true" className={linkClassName}>
            {content}
          </div>
        ) : (
          <Link
            href={href}
            aria-current={active ? "page" : undefined}
            className={linkClassName}
            onClick={onNavigate}
          >
            {content}
          </Link>
        )}
      </HoverHint>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: security } = useApi<{ configured: boolean }>(
    pathname === "/login" ? null : "/api/settings/security",
  );
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await postJson("/api/auth", undefined, "DELETE");
      window.location.replace("/login");
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : "Could not log out.");
      setLoggingOut(false);
    }
  }
  const logoutButton = (iconOnly = false) =>
    security?.configured && (
      <div className="border-t pt-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label="Log out"
          title="Log out"
          className={iconOnly ? "h-9 w-9 p-0" : "w-full justify-start gap-2"}
          onClick={logout}
          disabled={loggingOut}
        >
          <LogOut />
          {!iconOnly && "Log out"}
        </Button>
        {logoutError && (
          <p role="alert" className="text-xs text-destructive">
            {logoutError}
          </p>
        )}
      </div>
    );
  const search = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  const [navOrder, setNavOrder] = useState<string[]>(() => NAV.map(({ href }) => href));
  const [navReorderMode, setNavReorderMode] = useState(false);
  const [navOrderReady, setNavOrderReady] = useState(false);
  const { data: settingsData } = useApi<{
    navOrder: string[];
    navOrderSaved: boolean;
    timeZone?: string;
    headerMessage?: string;
  }>("/api/settings");
  const [mobileHeaderNotice, setMobileHeaderNotice] = useState<string | null>(null);
  const [mobileHeaderNoticeVisible, setMobileHeaderNoticeVisible] = useState(false);
  useEffect(
    () =>
      subscribeHeaderNotice((message, visible) => {
        setMobileHeaderNotice(message);
        setMobileHeaderNoticeVisible(visible);
      }),
    [],
  );
  const mobileHeaderMessage = useMemo(() => {
    const messages = (settingsData?.headerMessage ?? "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!messages.length) return "";
    const zone = settingsData?.timeZone ?? "UTC";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const key = parts
      .filter((part) => ["year", "month", "day"].includes(part.type))
      .map((part) => part.value)
      .join("-");
    const day = Math.floor(Date.parse(`${key}T00:00:00Z`) / 86400000);
    return messages[((day % messages.length) + messages.length) % messages.length] ?? "";
  }, [settingsData?.headerMessage, settingsData?.timeZone]);
  const isDashboard = pathname === "/";
  const navReorderRegionRef = useRef<HTMLDivElement>(null);
  const navReorderButtonRef = useRef<HTMLButtonElement>(null);
  const navSaveSequenceRef = useRef(0);
  const navSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!navReorderMode) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (navReorderRegionRef.current?.contains(target) ||
          navReorderButtonRef.current?.contains(target))
      )
        return;
      setNavReorderMode(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [navReorderMode]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1440px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  useEffect(() => {
    const read = () => {
      try {
        setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");
      } catch {
        setSidebarCollapsed(false);
      } finally {
        setSidebarReady(true);
      }
    };
    read();
    const sync = (event: StorageEvent) => {
      if (event.key === SIDEBAR_COLLAPSED_KEY || event.key === null) read();
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => {
    if (!settingsData) return;
    const serverOrder = settingsData.navOrder.filter((href) =>
      NAV.some((item) => item.href === href),
    );
    const normalizedServerOrder = [...new Set(serverOrder)];
    const missingServerItems = NAV.map(({ href }) => href).filter(
      (href) => !normalizedServerOrder.includes(href),
    );
    const completeServerOrder = [...normalizedServerOrder, ...missingServerItems];

    if (settingsData.navOrderSaved) {
      setNavOrder(completeServerOrder);
      setNavOrderReady(true);
      return;
    }

    let legacyOrder: string[] | null = null;
    try {
      const stored = JSON.parse(localStorage.getItem(NAV_ORDER_KEY) || "null");
      if (Array.isArray(stored)) {
        const migrated = stored.map((href) =>
          href === "/playbooks" ? "/strategies" : href === "/progress" ? "/routines" : href,
        );
        const valid = migrated.filter((href): href is string =>
          NAV.some((item) => item.href === href),
        );
        const unique = [...new Set(valid)];
        const missing = NAV.map(({ href }) => href).filter((href) => !unique.includes(href));
        legacyOrder = [...unique, ...missing];
      }
    } catch {
      // Ignore an invalid legacy browser-only order.
    }

    const initialOrder = legacyOrder ?? completeServerOrder;
    setNavOrder(initialOrder);
    setNavOrderReady(true);
    if (legacyOrder) void postJson("/api/settings", { navOrder: legacyOrder }, "PATCH");
  }, [settingsData]);
  function handleNavReorder(event: DragEndEvent) {
    if (!event.over || !navOrderReady) return;
    const active = String(event.active.id);
    const over = String(event.over.id);
    if (active === over) return;
    const from = navOrder.indexOf(active);
    const to = navOrder.indexOf(over);
    if (from < 0 || to < 0) return;
    const next = [...navOrder];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setNavOrder(next);
    const saveSequence = ++navSaveSequenceRef.current;
    void postJson("/api/settings", { navOrder: next }, "PATCH").catch(() => {
      if (saveSequence === navSaveSequenceRef.current) setNavOrder(navOrder);
    });
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  function toggleSidebar() {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // The interaction still works when storage is unavailable.
      }
      return next;
    });
  }
  const filterQuery = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = search.get(key);
    if (value) filterQuery.set(key, value);
  }
  if (search.get("range")) filterQuery.set("range", search.get("range")!);
  const orderedNav = useMemo(() => {
    const ordered = navOrder
      .map((href) => NAV.find((item) => item.href === href))
      .filter((item): item is (typeof NAV)[number] => item !== undefined);
    const used = new Set(ordered.map((item) => item.href));
    return [...ordered, ...NAV.filter((item) => !used.has(item.href))];
  }, [navOrder]);
  if (pathname === "/login") return <>{children}</>;
  const navigation = (collapsed = false) => (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="Journal navigation"
        className="journal-sidebar-navigation min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-2"
        onClick={(event) => {
          if (!navReorderMode && (event.target as HTMLElement).closest("a")) setMenuOpen(false);
        }}
      >
        <div ref={navReorderRegionRef} className="relative space-y-0.5">
          <DndContext
            sensors={navSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleNavReorder}
          >
            <SortableContext items={navOrder} strategy={verticalListSortingStrategy}>
              {orderedNav.map(({ href, label, icon }) => (
                <SortableNavLink
                  key={href}
                  href={filterQuery.size ? `${href}?${filterQuery}` : href}
                  sortableId={href}
                  label={label}
                  icon={icon}
                  collapsed={collapsed}
                  reorderMode={navReorderMode}
                  onNavigate={() => setMenuOpen(false)}
                  active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
                />
              ))}
            </SortableContext>
          </DndContext>
          {!collapsed && (
            <Button
              ref={navReorderButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              title="Reorder menu items"
              aria-label="Reorder menu items"
              aria-pressed={navReorderMode}
              onClick={() => setNavReorderMode((value) => !value)}
              className="absolute right-0 z-20 h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
              style={{ top: `${8 * 38 + 4}px` }}
            >
              <ListOrdered className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="!my-3 border-t" />
        {NAV_SETUP.map(({ href, label, icon }) => (
          <NavLink
            key={href}
            href={filterQuery.size ? `${href}?${filterQuery}` : href}
            label={label}
            icon={icon}
            collapsed={collapsed}
            active={pathname.startsWith(href)}
          />
        ))}
      </nav>
    </div>
  );
  const footer =
    process.env.NEXT_PUBLIC_SCREENSHOT_MODE === "1" ? null : (
      <div className="journal-sidebar-footer border-t p-3 text-xs text-muted-foreground">
        <AppVersion />
      </div>
    );
  return (
    <div className="journal-shell min-h-dvh min-[1440px]:flex">
      <header
        className={`journal-mobile-header sticky top-0 z-30 relative flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur min-[1440px]:hidden ${isDashboard ? "journal-mobile-dashboard-header" : ""}`}
      >
        <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DialogPrimitive.Trigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Open navigation"
              disableHint
            >
              <Menu />
            </Button>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="journal-nav-overlay fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
            <DialogPrimitive.Content
              className="journal-nav-drawer fixed inset-y-0 left-0 z-50 flex w-[min(288px,calc(100vw-40px))] flex-col border-r bg-card shadow-2xl"
              aria-describedby={undefined}
            >
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4">
                <BrandLogo className="h-7 w-7 shrink-0 object-contain" />
                <DialogPrimitive.Title className="text-sm font-semibold">
                  TraderJourney
                </DialogPrimitive.Title>
                <DialogPrimitive.Close asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto h-8 w-8"
                    aria-label="Close navigation"
                    disableHint
                  >
                    <X />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              {navigation()}
              <div className="space-y-2 border-t p-3">
                <ThemeToggle />
                <PrivacyToggle />
                {logoutButton()}
              </div>
              {footer}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <div
          className="journal-mobile-dashboard-notice absolute left-1/2 min-w-0 -translate-x-1/2 px-1 text-center"
          aria-live="polite"
        >
          <span
            className={`block max-w-[min(58vw,260px)] truncate text-xs font-bold text-muted-foreground transition-opacity duration-300 ${mobileHeaderNotice ? (mobileHeaderNoticeVisible ? "opacity-100" : "opacity-0") : "opacity-100"}`}
          >
            {mobileHeaderNotice ?? mobileHeaderMessage}
          </span>
        </div>
        <Link
          href="/"
          aria-label="TraderJourney dashboard"
          className="journal-mobile-dashboard-logo ml-auto flex h-9 w-9 shrink-0 items-center justify-center"
        >
          <BrandLogo className="h-7 w-7 object-contain" />
        </Link>
      </header>
      <aside
        className="journal-desktop-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-card/50 min-[1440px]:flex"
        data-collapsed={sidebarCollapsed}
        data-ready={sidebarReady}
      >
        <div className="journal-sidebar-header relative flex h-14 shrink-0 items-center border-b">
          <Link href="/" className="journal-sidebar-home flex h-full min-w-0 items-center gap-2.5">
            <BrandLogo className="h-7 w-7 shrink-0 object-contain" />
            <span className="journal-sidebar-brand-label text-sm font-semibold tracking-tight">
              TraderJourney
            </span>
          </Link>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="journal-sidebar-trigger absolute h-7 w-7 rounded-full bg-background shadow-sm"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!sidebarCollapsed}
            aria-keyshortcuts="Meta+B Control+B"
            title={`${sidebarCollapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-3.5 w-3.5" />
            ) : (
              <PanelLeftClose className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
        {navigation(sidebarCollapsed)}
        <div className="journal-sidebar-privacy border-t p-3">
          <div className="w-full space-y-1">
            <ThemeToggle iconOnly={sidebarCollapsed} />
            <PrivacyToggle iconOnly={sidebarCollapsed} />
            {logoutButton(sidebarCollapsed)}
          </div>
        </div>
        {footer}
      </aside>
      <PageTransition>{children}</PageTransition>
    </div>
  );
}
