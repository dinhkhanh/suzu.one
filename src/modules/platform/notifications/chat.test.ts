import { describe, expect, it } from "vitest";
import { chatCard } from "./chat";

describe("the Google Chat card", () => {
  const base = { title: "Đề nghị mua sắm", body: "Phạm Quốc Bảo đang chờ bạn duyệt.", link: "https://suzu.one/approvals/request/abc" };

  it("carries a plain-text fallback for a client that cannot draw a card", () => {
    const card = chatCard(base) as { text: string };
    expect(card.text).toContain("Đề nghị mua sắm");
    expect(card.text).toContain("https://suzu.one/approvals/request/abc");
  });

  it("offers the approve deep link as a button, beside the one that just opens the request", () => {
    const card = chatCard({ ...base, actionLink: "https://suzu.one/approvals/act/tok", actionLabel: "Duyệt" }) as { cardsV2: { card: { sections: { widgets: { buttonList?: { buttons: { text: string; onClick: { openLink: { url: string } } }[] } }[] }[] } }[] };
    const buttons = card.cardsV2[0].card.sections[0].widgets.flatMap((widget) => widget.buttonList?.buttons ?? []);
    expect(buttons.map((button) => button.text)).toEqual(["Duyệt", "Mở Suzu One"]);
    expect(buttons[0].onClick.openLink.url).toBe("https://suzu.one/approvals/act/tok");
  });

  it("draws no button list at all when there is nowhere to go", () => {
    const card = chatCard({ title: "x", body: "y", link: null }) as { cardsV2: { card: { sections: { widgets: unknown[] }[] } }[] };
    expect(card.cardsV2[0].card.sections[0].widgets).toHaveLength(1);
  });
});
