import { describe, expect, it } from "vitest";
import { dropMentions, extractMentionIds, fromDraft, mentionQueryAt, mentionToken, parseBody, splitDraft, toDraft } from "./mentions";

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

describe("the draft in the text box", () => {
  const LAN = "33333333-3333-4333-8333-333333333333";
  const LAN_ANH = "44444444-4444-4444-8444-444444444444";

  it("shows a stored mention as @name and puts the token back on the way out", () => {
    const body = `${mentionToken("Hồ Gia Huy", HUY)} xem giúp, cc ${mentionToken("Bùi Thanh Tâm", TAM)}.`;
    const draft = toDraft(body);
    expect(draft.text).toBe("@Hồ Gia Huy xem giúp, cc @Bùi Thanh Tâm.");
    expect(draft.mentions).toEqual([
      { name: "Hồ Gia Huy", personId: HUY },
      { name: "Bùi Thanh Tâm", personId: TAM },
    ]);
    expect(fromDraft(draft.text, draft.mentions)).toBe(body);
  });

  it("reads the longest picked name first and only where a word ends", () => {
    const mentions = [
      { name: "Lan", personId: LAN },
      { name: "Lan Anh", personId: LAN_ANH },
    ];
    expect(fromDraft("@Lan Anh và @Lan, không phải @Lanh", mentions)).toBe(`${mentionToken("Lan Anh", LAN_ANH)} và ${mentionToken("Lan", LAN)}, không phải @Lanh`);
  });

  it("leaves a name typed by hand, and one edited away, as plain text", () => {
    const mentions = [{ name: "Hồ Gia Huy", personId: HUY }];
    expect(fromDraft("@Bùi Thanh Tâm và @Hồ Gia", mentions)).toBe("@Bùi Thanh Tâm và @Hồ Gia");
    expect(splitDraft("hi @Hồ Gia Huy!", mentions)).toEqual([
      { type: "text", text: "hi " },
      { type: "mention", name: "Hồ Gia Huy", personId: HUY },
      { type: "text", text: "!" },
    ]);
    expect(splitDraft("", mentions)).toEqual([]);
  });
});
