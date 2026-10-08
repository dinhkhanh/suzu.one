// What may reach a model (FR-AI-06, SRS §4.15 rule 4): no contact detail ever, no amount of money
// out of a passage, no sentence about pay out of a thread — and the asker's own payslip figures,
// which are the one exception, intact.
import { describe, expect, it } from "vitest";
import { REDACTED, threadText } from "./drafts";
import { chatRequestForModel, draftRequestForModel, passageForModel, redactContacts, redactMoney } from "./redact";
import { buildToolUserMessage } from "./tool-prompt";

describe("redactContacts", () => {
  it("takes out Vietnamese phone numbers however they are typed", () => {
    for (const phone of ["0912345678", "0912 345 678", "0912.345.678", "091-234-5678", "028 3823 1234", "+84912345678", "+84 912 345 678", "(+84) 912-345-678", "+84 28 3823 1234"]) {
      const text = redactContacts(`Gọi chị Mai theo số ${phone} trước 17h.`);
      expect(text, phone).toBe(`Gọi chị Mai theo số ${REDACTED} trước 17h.`);
    }
  });

  it("takes out email addresses", () => {
    expect(redactContacts("Gửi file cho mai.tran@khachhang.com.vn và cc lan+brief@suzu.group nhé")).toBe(`Gửi file cho ${REDACTED} và cc ${REDACTED} nhé`);
    expect(redactContacts("mailto:mai@client.vn")).toBe(`mailto:${REDACTED}`);
  });

  it("takes out Zalo and Messenger handles written as links, whole", () => {
    for (const link of [
      "https://zalo.me/0912345678",
      "zalo.me/g/abcxyz123",
      "https://chat.zalo.me/?phone=0912345678",
      "m.me/mai.tran.92",
      "https://www.messenger.com/t/1000123456789",
      "https://www.facebook.com/messages/t/mai.tran",
      "https://t.me/maitran",
    ]) {
      expect(redactContacts(`Nhắn khách qua ${link} nhé`), link).toBe(`Nhắn khách qua ${REDACTED} nhé`);
    }
  });

  it("leaves dates, hours, counts, references and amounts alone", () => {
    for (const text of [
      "Hạn 05/10/2026, họp lúc 08:30, vòng 2, còn 3 việc.",
      "Hẹn ngày 05-10-2026 08:00 tại văn phòng.",
      "Từ 2026-10-05 09:30:00 đến 2026-10-06.",
      "Mã việc SZM-0312, bản v12, 1200 từ, 45 phút.",
      "net = 30000000, gross = 35250000, paidDays = 22",
      "Trang https://suzu.one/kb/pages/0f8a0d1e-0912-4a5b-8c7d-1234567890ab#h-2",
      "Tỉ lệ 0.25 và 0,5 ngày công.",
    ]) {
      expect(redactContacts(text), text).toBe(text);
    }
  });
});

describe("redactMoney (knowledge-base passages)", () => {
  it("takes out the figures and keeps the rule", () => {
    expect(redactMoney("Lương được trả vào ngày 5 hàng tháng.")).toBe("Lương được trả vào ngày 5 hàng tháng.");
    expect(redactMoney("Phụ cấp ăn trưa 730.000 đ mỗi tháng, trả cùng kỳ lương.")).toBe(`Phụ cấp ăn trưa ${REDACTED} mỗi tháng, trả cùng kỳ lương.`);
  });

  it("takes out a salary table's cells, which carry no unit", () => {
    const table = "| Bậc | Lương cơ bản |\n| --- | --- |\n| Junior | 12.000.000 |\n| Senior | 30,000,000 |";
    const redacted = redactMoney(table);
    expect(redacted).not.toMatch(/12\.000\.000|30,000,000/);
    expect(redacted).toContain("| Junior |");
  });

  it("leaves days, hours, years and small counts alone", () => {
    const text = "Phép năm 12 ngày, thâm niên 5 năm cộng 1 ngày. Năm 2026 có 1.200 giờ làm thêm tối đa 200 giờ.";
    expect(redactMoney(text)).toBe(text);
  });
});

describe("the chat request a model is given", () => {
  const passage = {
    chunkId: "c1",
    pageId: "p1",
    pageTitle: "Liên hệ phòng Nhân sự",
    spaceKey: "so-tay",
    spaceName: "Sổ tay",
    headingPath: "Liên hệ phòng Nhân sự › Hotline 0283 823 1234",
    anchor: "h-1",
    content: "Cần gấp thì gọi chị Hà 0912 345 678 hoặc viết cho ha.nguyen@suzu.group. Zalo: https://zalo.me/0912345678. Thưởng Tết năm nay là 15.000.000 đồng.",
    vectorScore: 0.9,
    score: 0.8,
    lexical: 0.7,
  };

  it("holds no phone, no email, no chat link and no amount — in the text or the headings", () => {
    const outbound = chatRequestForModel({ question: "Liên hệ nhân sự thế nào? Số tôi là 0987654321", passages: [passage] });
    const sent = JSON.stringify(outbound);
    for (const secret of ["0912 345 678", "0912345678", "ha.nguyen@suzu.group", "zalo.me", "0283 823 1234", "15.000.000", "0987654321"]) expect(sent, secret).not.toContain(secret);
    // What is ours is untouched: the ids and the anchor the citation is built from.
    expect(outbound.passages[0]).toMatchObject({ chunkId: "c1", pageId: "p1", anchor: "h-1", pageTitle: "Liên hệ phòng Nhân sự" });
    expect(outbound.passages[0].content).toContain("Cần gấp thì gọi chị Hà");
  });

  it("keeps the words of the question — pay is its subject, not a leak", () => {
    expect(chatRequestForModel({ question: "Ngày trả lương là ngày nào?", passages: [] }).question).toBe("Ngày trả lương là ngày nào?");
  });

  it("does not change what the caller holds", () => {
    const before = JSON.stringify(passage);
    chatRequestForModel({ question: "x", passages: [passage] });
    expect(JSON.stringify(passage)).toBe(before);
    expect(passageForModel(passage.content)).not.toBe(passage.content);
  });
});

describe("the draft request a model is given", () => {
  const thread = {
    title: "Banner Tết cho khách Minh Long",
    description: "Liên hệ khách: anh Long 0903 123 456, long@minhlong.vn.",
    stateName: "Đang làm",
    comments: [
      { author: "Lan", body: "Đã gửi bản 2. Khách nhắn qua zalo.me/0903123456 là cần sửa màu." },
      { author: "Huy", body: "Phí thiết kế 12.000.000 đ đã chốt. Lương tháng này của mình bị trừ vì việc này." },
      { author: "Lan", body: "Còn chờ chị Mai (+84 912 345 678) duyệt nội dung." },
    ],
  };

  it("holds no phone and no email from a hand-off thread, and no pay", () => {
    const outbound = draftRequestForModel({ instruction: "Summarise this task's thread into a hand-off note.", facts: threadText(thread), locale: "vi" });
    for (const secret of ["0903 123 456", "0903123456", "long@minhlong.vn", "zalo.me", "912 345 678", "12.000.000", "Lương"]) expect(outbound.facts, secret).not.toContain(secret);
    // The work itself is still there to summarise.
    expect(outbound.facts).toContain("Đã gửi bản 2.");
    expect(outbound.facts).toContain("duyệt nội dung");
    expect(outbound.locale).toBe("vi");
  });

  it("keeps our instruction, whatever name is inside it", () => {
    const outbound = draftRequestForModel({ instruction: 'Write the summary for the project "Video thưởng Tết — gọi 0912345678": three sentences.', facts: "" });
    expect(outbound.instruction).toBe(`Write the summary for the project "Video thưởng Tết — gọi ${REDACTED}": three sentences.`);
  });
});

describe("a tool's answer in a prompt", () => {
  it("still carries the asker's own payslip figures, every one — FR-AI-06's one exception", () => {
    const answer = {
      tool: "payslip_explain" as const,
      key: "summary",
      params: { month: "2026-08", entity: "Media", gross: 30_000_000, insurance: 3_150_000, pit: 912_345_678, net: 25_937_655, paidDays: 22 },
      lines: [{ key: "earning", params: { code: "BASE", name: "Lương cơ bản", amount: 30_000_000, rule: "22/22 ngày công" } }],
      link: "/payslips/x",
    };
    const prompt = buildToolUserMessage({ askerPersonId: "me", subjectPersonId: "me", question: "Giải thích phiếu lương tháng 8 của tôi", answer });
    for (const figure of ["30000000", "3150000", "912345678", "25937655", "paidDays = 22", "Lương cơ bản"]) expect(prompt, figure).toContain(figure);
  });

  it("loses a contact detail in the record's words or in the question", () => {
    const answer = { tool: "approver_lookup" as const, key: "summary", params: { kind: "leave", first: "Dang Hoang Long (long@suzu.group, 0912345678)" }, lines: [], link: null };
    const prompt = buildToolUserMessage({ askerPersonId: "me", subjectPersonId: "me", question: "Ai duyệt đơn của tôi? Gọi tôi số 0987 654 321", answer });
    for (const secret of ["long@suzu.group", "0912345678", "0987 654 321"]) expect(prompt, secret).not.toContain(secret);
    expect(prompt).toContain("Dang Hoang Long");
  });
});
