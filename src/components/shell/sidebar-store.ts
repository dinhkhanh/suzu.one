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
