import { describe, expect, it } from "vitest";
import { dropMentions, extractMentionIds, mentionQueryAt, mentionToken, parseBody } from "./mentions";

const HUY = "11111111-1111-4111-8111-111111111111";
const TAM = "22222222-2222-4222-8222-222222222222";

describe("comment bodies", () => {
  it("finds each mentioned person once, in order", () => {
    const body = `${mentionToken("Hồ Gia Huy", HUY)} xem giúp, cc ${mentionToken("Bùi Thanh Tâm", TAM)} và ${mentionToken("Hồ Gia Huy", HUY)}`;
    expect(extractMentionIds(body)).toEqual([HUY, TAM]);
    expect(extractMentionIds("no @mention here, a@b.c, @[broken](not-a-uuid)")).toEqual([]);
  });

  it("turns a mention of someone outside the task into plain text", () => {
    const body = `${mentionToken("Huy", HUY)} và ${mentionToken("Tâm", TAM)}`;
    expect(dropMentions(body, new Set([HUY]))).toBe(`@[Huy](${HUY}) và @Tâm`);
    expect(extractMentionIds(dropMentions(body, new Set([HUY])))).toEqual([HUY]);
  });

  it("keeps brackets out of a name so a token cannot be forged through it", () => {
    expect(mentionToken("A](x) [B", HUY)).toBe(`@[A (x)  B](${HUY})`);
  });

  it("splits a body into text, mentions and links; trailing punctuation stays text", () => {
    expect(parseBody(`Bản dựng v2: https://drive.google.com/file/d/abc/view. ${mentionToken("Tâm", TAM)} duyệt nhé (xem https://youtu.be/xyz)`)).toEqual([
      { type: "text", text: "Bản dựng v2: " },
      { type: "link", url: "https://drive.google.com/file/d/abc/view" },
      { type: "text", text: "." },
      { type: "text", text: " " },
      { type: "mention", personId: TAM, name: "Tâm" },
      { type: "text", text: " duyệt nhé (xem " },
      { type: "link", url: "https://youtu.be/xyz" },
      { type: "text", text: ")" },
    ]);
  });

  it("never makes a script address clickable", () => {
    expect(parseBody("javascript:alert(1) data:text/html,x")).toEqual([{ type: "text", text: "javascript:alert(1) data:text/html,x" }]);
  });

  it("finds the mention being typed at the caret", () => {
    expect(mentionQueryAt("gửi @gia hu", 11)).toEqual({ start: 4, query: "gia hu" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("mail a@b", 8)).toBeNull();
    expect(mentionQueryAt(`${mentionToken("Huy", HUY)} ok`, 45)).toBeNull();
  });
});
