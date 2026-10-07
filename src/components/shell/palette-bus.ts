"use client";

// The sidebar's quick-actions button and Cmd/Ctrl+K open the same palette; the palette lives
// deeper in the tree than the button, so they meet on a window event rather than shared state.
export const PALETTE_EVENT = "suzu:palette";
/** The phone's quick-add sheet asks for a new task: the palette opens straight on its create form. */
export const PALETTE_CREATE_EVENT = "suzu:palette:create";

export function openCommandPalette() {
  window.dispatchEvent(new CustomEvent(PALETTE_EVENT));
}

/**
 * What the create form opens filled in with — the assistant's Sửa on a proposed task (Phase 13 R4).
 * `place` is "project:<id>" or "team:<id>"; `mine` ticks "assign to me".
 */
export type QuickCreatePrefill = { title?: string; dueDate?: string; place?: string; mine?: boolean };

export function openQuickCreate(prefill?: QuickCreatePrefill) {
  window.dispatchEvent(new CustomEvent(PALETTE_CREATE_EVENT, { detail: prefill ?? null }));
}
