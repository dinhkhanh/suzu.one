import { describe, expect, it } from "vitest";
import { pickReviewer, type ReviewState, stateOnApproval, stateOnChangesRequested, stateOnSubmit } from "./review";

const state = (id: string, category: ReviewState["category"], sortOrder: number, isActive = true): ReviewState => ({ id, category, sortOrder, isActive });
const content = [state("backlog", "backlog", 0), state("brief", "todo", 1), state("edit", "in_progress", 5), state("internal", "in_review", 6), state("client", "in_review", 7), state("scheduled", "in_progress", 8), state("published", "done", 9), state("cancelled", "cancelled", 11)];

describe("pickReviewer", () => {
  it("takes the first candidate who is not the submitter", () => {
    expect(pickReviewer(["a", "b"], "c")).toBe("a");
    expect(pickReviewer(["a", "b"], "a")).toBe("b");
    expect(pickReviewer([null, undefined, "b"], "a")).toBe("b");
    expect(pickReviewer(["a", null], "a")).toBeNull();
  });
});

describe("review state moves", () => {
  it("moves to the first review state on hand-in, but not when already in review", () => {
    expect(stateOnSubmit(content, "edit")).toBe("internal");
    expect(stateOnSubmit(content, "internal")).toBeNull();
    expect(stateOnSubmit(content, "client")).toBeNull();
    expect(stateOnSubmit([state("todo", "todo", 0), state("done", "done", 1)], "todo")).toBeNull();
  });
  it("skips a retired review state", () => {
    expect(stateOnSubmit([state("doing", "in_progress", 0), state("old", "in_review", 1, false), state("review", "in_review", 2)], "doing")).toBe("review");
  });
  it("approval moves on one step from a review state only", () => {
    expect(stateOnApproval(content, "internal")).toBe("client");
    expect(stateOnApproval(content, "client")).toBe("scheduled");
    expect(stateOnApproval(content, "edit")).toBeNull();
    expect(stateOnApproval([state("review", "in_review", 0), state("cancelled", "cancelled", 1)], "review")).toBeNull();
  });
  it("requested changes send the task back to the nearest working step", () => {
    expect(stateOnChangesRequested(content, "internal")).toBe("edit");
    expect(stateOnChangesRequested(content, "client")).toBe("edit");
    expect(stateOnChangesRequested(content, "edit")).toBeNull();
    expect(stateOnChangesRequested([state("todo", "todo", 0), state("review", "in_review", 1)], "review")).toBeNull();
  });
});
