import { describe, expect, it } from "vitest";
import { DRAFT_DAYS, draftKey, forgetAllDrafts, parseDraft, readDraft, removeDraft, sweepDrafts, writeDraft } from "./drafts";

// localStorage's shape, in memory: the tests run in plain Node.
function memoryStore(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    keys: () => [...map.keys()],
  };
}

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 2, 9);

describe("note drafts", () => {
  it("keeps one draft per person and field, and gives it back", () => {
    const store = memoryStore();
    const mine = draftKey("p1", "/work/tasks/1#description");
    writeDraft(mine, "half a sentence", now, store);
    expect(readDraft(mine, now + DAY, store)).toEqual({ text: "half a sentence", at: now });
    expect(readDraft(draftKey("p2", "/work/tasks/1#description"), now, store)).toBeNull();
    removeDraft(mine, store);
    expect(readDraft(mine, now, store)).toBeNull();
  });

  it("drops a draft left longer than the limit, and anything that is not a draft", () => {
    const store = memoryStore();
    const key = draftKey("p1", "feedback");
    writeDraft(key, "old words", now - (DRAFT_DAYS + 1) * DAY, store);
    expect(readDraft(key, now, store)).toBeNull();
    expect(store.keys()).toEqual([]);
    expect(parseDraft("{not json", now)).toBeNull();
    expect(parseDraft(JSON.stringify({ text: 3, at: now }), now)).toBeNull();
  });

  it("forgets every draft on sign-out and sweeps only the stale ones, leaving other keys alone", () => {
    const fresh = JSON.stringify({ text: "fresh", at: now - DAY });
    const stale = JSON.stringify({ text: "stale", at: now - (DRAFT_DAYS + 2) * DAY });
    const store = memoryStore({ [draftKey("p1", "a")]: fresh, [draftKey("p1", "b")]: stale, "suzu:sidebar": "1" });
    sweepDrafts(now, store);
    expect(store.keys().sort()).toEqual([draftKey("p1", "a"), "suzu:sidebar"].sort());
    forgetAllDrafts(store);
    expect(store.keys()).toEqual(["suzu:sidebar"]);
  });

  it("carries on without storage", () => {
    expect(() => writeDraft("k", "text", now, null)).not.toThrow();
    expect(readDraft("k", now, null)).toBeNull();
    const full = {
      ...memoryStore(),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeDraft("k", "text", now, full)).not.toThrow();
  });
});
