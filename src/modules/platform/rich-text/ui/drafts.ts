// Drafts of what somebody is writing in a note editor, kept in this browser until the form is sent:
// a dialog closed by a stray tap, a reload, a lost connection, and the words are still there when
// the form opens again. One draft per person and field. They never leave the device; signing out
// forgets them all, and one untouched for DRAFT_DAYS is dropped.
//
// A form says it was sent with `draftSaved(form)` (useActionForm does it for every form it
// submits); a form's reset says the same. Either drops the drafts of the editors inside it.

export const DRAFT_PREFIX = "suzu:draft:";
export const DRAFT_DAYS = 30;
export const DRAFT_SAVED_EVENT = "note-draft-saved";

export type Draft = { text: string; at: number };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const storage = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Blocked storage: no drafts, and nothing else changes.
    return null;
  }
};

export const draftKey = (personId: string, scope: string) => `${DRAFT_PREFIX}${personId}:${scope}`;

/** A stored draft, or null when it is not one or has been left longer than DRAFT_DAYS. */
export function parseDraft(raw: string | null | undefined, now: number): Draft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Partial<Draft>;
    if (typeof draft.text !== "string" || typeof draft.at !== "number") return null;
    return now - draft.at > DRAFT_DAYS * 86_400_000 ? null : { text: draft.text, at: draft.at };
  } catch {
    return null;
  }
}

export function readDraft(key: string, now = Date.now(), store = storage()): Draft | null {
  try {
    const raw = store?.getItem(key);
    const draft = parseDraft(raw, now);
    if (raw && !draft) store?.removeItem(key);
    return draft;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, text: string, now = Date.now(), store = storage()): void {
  try {
    store?.setItem(key, JSON.stringify({ text, at: now } satisfies Draft));
  } catch {
    // Full or blocked: the draft is not kept, the form works as it did.
  }
}

export function removeDraft(key: string, store = storage()): void {
  try {
    store?.removeItem(key);
  } catch {
    // Blocked storage held nothing to remove.
  }
}

/** Every draft's key, or only those of drafts older than DRAFT_DAYS when `expiredBy` is given. */
function draftKeys(store: Store, expiredBy?: number): string[] {
  const keys: string[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (!key?.startsWith(DRAFT_PREFIX)) continue;
    if (expiredBy === undefined || parseDraft(store.getItem(key), expiredBy) === null) keys.push(key);
  }
  return keys;
}

/** Signing out: nobody who uses this browser next finds what was being written. */
export function forgetAllDrafts(store = storage()): void {
  try {
    if (store) draftKeys(store).forEach((key) => store.removeItem(key));
  } catch {
    // Blocked storage held no drafts.
  }
}

/** Drops drafts nobody came back to. */
export function sweepDrafts(now = Date.now(), store = storage()): void {
  try {
    if (store) draftKeys(store, now).forEach((key) => store.removeItem(key));
  } catch {
    // Blocked storage held no drafts.
  }
}

/** The form was sent: its editors' drafts are done with. */
export function draftSaved(form: HTMLFormElement | null | undefined): void {
  form?.dispatchEvent(new Event(DRAFT_SAVED_EVENT));
}
