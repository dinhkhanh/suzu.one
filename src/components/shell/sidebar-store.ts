"use client";

// Whether the sidebar is folded to a rail is a preference of this browser, not of the account,
// so it lives in localStorage. `useSyncExternalStore` reads it: the server renders the sidebar
// open, and the client corrects it on hydration without an effect.
const KEY = "suzu.sidebar.collapsed";
const listeners = new Set<() => void>();
let cached: boolean | null = null;

export function subscribeCollapsed(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readCollapsed() {
  if (cached === null) {
    try {
      cached = window.localStorage.getItem(KEY) === "1";
    } catch {
      cached = false;
    }
  }
  return cached;
}

// What the server renders, and what hydration starts from.
export function readCollapsedOnServer() {
  return false;
}

export function writeCollapsed(next: boolean) {
  cached = next;
  try {
    window.localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // A browser that refuses storage still gets the toggle, just not the memory of it.
  }
  for (const listener of listeners) listener();
}

// Which of the sidebar's sections are folded shut: the same kind of preference, kept the same way.
// The snapshot is one array per change, so `useSyncExternalStore` sees a new value only on a write.
const FOLDED_KEY = "suzu.sidebar.folded";
const foldedListeners = new Set<() => void>();
const NONE_FOLDED: readonly string[] = [];
let folded: readonly string[] | null = null;

export function subscribeFolded(listener: () => void) {
  foldedListeners.add(listener);
  return () => foldedListeners.delete(listener);
}

export function readFolded(): readonly string[] {
  if (folded === null) {
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(FOLDED_KEY) ?? "[]");
      folded = Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : NONE_FOLDED;
    } catch {
      folded = NONE_FOLDED;
    }
  }
  return folded;
}

// Every section open: what the server renders, and what hydration starts from.
export function readFoldedOnServer(): readonly string[] {
  return NONE_FOLDED;
}

export function writeFolded(section: string, shut: boolean) {
  const current = readFolded();
  folded = shut ? [...current.filter((key) => key !== section), section] : current.filter((key) => key !== section);
  try {
    window.localStorage.setItem(FOLDED_KEY, JSON.stringify(folded));
  } catch {
    // As above: the fold still works, it is just not remembered.
  }
  for (const listener of foldedListeners) listener();
}
