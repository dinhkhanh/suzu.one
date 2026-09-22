import { describe, expect, it } from "vitest";
import { foldSmallGroups } from "./privacy";

const group = (key: string, ...personIds: string[]) => ({ key, personIds });

describe("folding small groups (security review, finding 22)", () => {
  it("keeps groups of two or more as they are", () => {
    const folded = foldSmallGroups([group("video", "huy", "bao"), group("social", "sang", "lan", "khoi")], new Set());
    expect(folded).toEqual({ kept: ["video", "social"], other: null, dropped: [] });
  });

  it("folds one-person teams together when that makes a group", () => {
    const folded = foldSmallGroups([group("video", "huy", "bao"), group("design", "mai"), group("copy", "chi")], new Set());
    expect(folded.kept).toEqual(["video"]);
    expect(folded.other).toEqual({ keys: ["design", "copy"], personIds: ["mai", "chi"] });
    expect(folded.dropped).toEqual([]);
  });

  it("drops the one person when there is no second small team to join", () => {
    const groups = [group("video", "huy", "bao", "long"), group("design", "mai", "vy"), group("copy", "chi")];
    // The groups big enough to stand alone are shown as they are; Chi's figures are left out.
    expect(foldSmallGroups(groups, new Set())).toEqual({ kept: ["video", "design"], other: null, dropped: ["chi"] });
  });

  it("drops the person when there is nothing to hide them among — totals included", () => {
    const folded = foldSmallGroups([group("copy", "chi")], new Set());
    expect(folded).toEqual({ kept: [], other: null, dropped: ["chi"] });
  });

  it("a team the reader runs is shown whatever its size, and never folded away", () => {
    const folded = foldSmallGroups([group("video", "huy"), group("copy", "chi")], new Set(["video"]));
    expect(folded.kept).toEqual(["video"]);
    expect(folded.other).toBeNull();
    expect(folded.dropped).toEqual(["chi"]);
  });

  it("someone shown in a big team of their own is not 'dropped' for also being in a folded one", () => {
    // Huy's figures are already on the page under Video; only his Copywriting row goes.
    const folded = foldSmallGroups([group("video", "huy", "bao"), group("copy", "huy")], new Set());
    expect(folded).toEqual({ kept: ["video"], other: null, dropped: [] });
  });
});
