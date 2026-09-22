import { describe, expect, it } from "vitest";
import { mapStatesByCategory } from "./move";

const state = (id: string, category: string, sortOrder: number, isActive = true) => ({ id, category, sortOrder, isActive });
const social = [state("s-backlog", "backlog", 10), state("s-brief", "todo", 20), state("s-write", "in_progress", 30), state("s-review", "in_review", 40), state("s-posted", "done", 50), state("s-cancel", "cancelled", 60)];

describe("mapStatesByCategory", () => {
  it("lands on the target's first active state of the same category", () => {
    const video = [state("v-backlog", "backlog", 10), state("v-brief", "todo", 20), state("v-edit", "in_progress", 40), state("v-script", "in_progress", 30), state("v-client", "in_review", 60), state("v-internal", "in_review", 50), state("v-done", "done", 70), state("v-cancel", "cancelled", 80)];
    expect(Object.fromEntries(mapStatesByCategory(social, video))).toEqual({ "s-backlog": "v-backlog", "s-brief": "v-brief", "s-write": "v-script", "s-review": "v-internal", "s-posted": "v-done", "s-cancel": "v-cancel" });
  });
  it("falls back to a near state that keeps open work open, and says when nothing fits", () => {
    const lean = [state("l-todo", "todo", 10), state("l-doing", "in_progress", 20), state("l-review", "in_review", 5, false), state("l-done", "done", 30)];
    expect(Object.fromEntries(mapStatesByCategory(social, lean))).toEqual({ "s-backlog": "l-todo", "s-brief": "l-todo", "s-write": "l-doing", "s-review": "l-doing", "s-posted": "l-done", "s-cancel": "l-done" });
    expect(Object.fromEntries(mapStatesByCategory(social, [state("x-backlog", "backlog", 1)]))).toEqual({ "s-backlog": "x-backlog", "s-brief": "x-backlog", "s-write": null, "s-review": null, "s-posted": null, "s-cancel": null });
  });
});
