/** One Node server owns the data directory. Includes awaited broker sync requests. */
const shared = globalThis as typeof globalThis & {
  __journalAccess?: { active: number; exclusive: boolean; unavailable: boolean };
};
const state = (shared.__journalAccess ??= { active: 0, exclusive: false, unavailable: false });

export function enterDataAccess(exclusive = false): (() => void) | null {
  if (state.unavailable || state.exclusive || (exclusive && state.active > 0)) return null;
  state.active++;
  if (exclusive) state.exclusive = true;
  return () => {
    state.active--;
    if (exclusive) state.exclusive = false;
  };
}

export function stopDataAccess() {
  state.unavailable = true;
}
