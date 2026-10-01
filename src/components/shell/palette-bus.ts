"use client";

// The sidebar's quick-actions button and Cmd/Ctrl+K open the same palette; the palette lives
// deeper in the tree than the button, so they meet on a window event rather than shared state.
export const PALETTE_EVENT = "suzu:palette";
/** The phone's quick-add sheet asks for a new task: the palette opens straight on its create form. */
export const PALETTE_CREATE_EVENT = "suzu:palette:create";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

export function openQuickCreate() {
  window.dispatchEvent(new CustomEvent(PALETTE_CREATE_EVENT));
}
