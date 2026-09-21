"use client";

// The sidebar's quick-actions button and Cmd/Ctrl+K open the same palette; the palette lives
// deeper in the tree than the button, so they meet on a window event rather than shared state.
export const PALETTE_EVENT = "suzu:palette";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}
