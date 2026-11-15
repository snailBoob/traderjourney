"use client";

const STORAGE_KEY = "tj-header-notice";
const EVENT_NAME = "tj:header-notice";
const VISIBLE_MS = 4700;
const TOTAL_MS = 5000;
type StoredNotice = { message: string; fadeAt: number; expiresAt: number };

export function publishHeaderNotice(message: string): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const notice: StoredNotice = { message, fadeAt: now + VISIBLE_MS, expiresAt: now + TOTAL_MS };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notice));
  } catch {
    /* Session storage may be unavailable. */
  }
  window.dispatchEvent(new CustomEvent<StoredNotice>(EVENT_NAME, { detail: notice }));
}

export function subscribeHeaderNotice(
  callback: (message: string | null, visible: boolean) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  let fadeTimer: number | undefined;
  let clearTimer: number | undefined;
  let activeExpiresAt = 0;

  const clearTimers = () => {
    if (fadeTimer !== undefined) window.clearTimeout(fadeTimer);
    if (clearTimer !== undefined) window.clearTimeout(clearTimer);
  };
  const read = (): StoredNotice | null => {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const notice = JSON.parse(raw) as StoredNotice;
      if (!notice.message || notice.expiresAt <= Date.now()) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      // Older session notices may not have fadeAt; apply the standard timing.
      if (!Number.isFinite(notice.fadeAt))
        notice.fadeAt = notice.expiresAt - (TOTAL_MS - VISIBLE_MS);
      return notice;
    } catch {
      return null;
    }
  };
  const activate = (notice: StoredNotice | null) => {
    clearTimers();
    if (!notice || notice.expiresAt <= Date.now()) {
      activeExpiresAt = 0;
      callback(null, false);
      return;
    }
    activeExpiresAt = notice.expiresAt;
    const now = Date.now();
    callback(notice.message, now < notice.fadeAt);
    fadeTimer = window.setTimeout(
      () => {
        if (activeExpiresAt === notice.expiresAt) callback(notice.message, false);
      },
      Math.max(0, notice.fadeAt - now),
    );
    clearTimer = window.setTimeout(
      () => {
        if (activeExpiresAt !== notice.expiresAt) return;
        try {
          const current = window.sessionStorage.getItem(STORAGE_KEY);
          if (current && (JSON.parse(current) as StoredNotice).expiresAt === notice.expiresAt)
            window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          /* Session storage may be unavailable. */
        }
        activeExpiresAt = 0;
        callback(null, false);
      },
      Math.max(0, notice.expiresAt - now),
    );
  };

  activate(read());
  const handle = (event: Event) => activate((event as CustomEvent<StoredNotice>).detail ?? null);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) activate(read());
  };
  window.addEventListener(EVENT_NAME, handle);
  window.addEventListener("storage", handleStorage);
  return () => {
    clearTimers();
    window.removeEventListener(EVENT_NAME, handle);
    window.removeEventListener("storage", handleStorage);
  };
}
