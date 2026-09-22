// Golden drafts of the local driver (FR-PJM-64) and the compensation guardrail (FR-AI-06): the same
// facts always give the same draft, it adds nothing that was not recorded, and no amount of money
// or sentence about pay survives on its way to a model.
import { describe, expect, it } from "vitest";
import { eodDraftLines, handoffDraft, REDACTED, redactCompensation, statusDraftLines, suggestedHealth, threadText } from "./drafts";

describe("redactCompensation", () => {
  it("takes out amounts of money in the ways people write them", () => {
    expect(redactCompensation("Chi phí in ấn 15.000.000 đ đã duyệt")).toBe(`Chi phí in ấn ${REDACTED} đã duyệt`);
    expect(redactCompensation("Budget VND 3,000,000 for ads, plus $1200 for props")).toBe(`Budget ${REDACTED} for ads, plus ${REDACTED} for props`);
    expect(redactCompensation("Khách chốt 20 triệu, cọc 5tr")).toBe(`Khách chốt ${REDACTED}, cọc ${REDACTED}`);
  });

  it("takes out whole sentences about pay, in Vietnamese and English", () => {
    expect(redactCompensation("Đã gửi bản dựng. Lương tháng này của Huy bị chậm. Mai quay tiếp.")).toBe(`Đã gửi bản dựng. ${REDACTED} Mai quay tiếp.`);
    expect(redactCompensation("Bonus for the team is pending! Export sent.")).toBe(`${REDACTED} Export sent.`);
  });

  it("leaves ordinary work words alone — counts, dates, pages, rounds", () => {
    const text = "Làm 2 đợt, 12 trang, sửa vòng 3 ngày 15/10. Thưởng thức bữa trưa? Không liên quan.";
    // "thưởng thức" (to enjoy) is not "thưởng" (bonus): whole words only.
    expect(redactCompensation(text)).toBe(text);
  });
});

describe("eodDraftLines", () => {
  it("says what was done, reviewed, handed off and left, and the hours — in that order", () => {
    const lines = eodDraftLines({
      done: [{ title: "Key visual Tết", ref: "SOC-12" }],
      notDone: [{ title: "Caption tuần 3", ref: "SOC-15" }],
      activity: [
        { kind: "submitted", title: "Key visual Tết", ref: "SOC-12" },
        { kind: "reviewed", title: "Storyboard TVC", ref: "VID-4" },
        { kind: "handoff_sent", title: "Key visual Tết", ref: "SOC-12" },
        { kind: "commented", title: "Caption tuần 3", ref: "SOC-15" },
        { kind: "blocker_raised", title: "Caption tuần 3", ref: "SOC-15" },
      ],
      minutesLogged: 405,
    });
    expect(lines).toEqual([
      { key: "eod.done", params: { count: 1, items: "SOC-12 Key visual Tết" } },
      { key: "eod.submitted", params: { count: 1, items: "SOC-12 Key visual Tết" } },
      { key: "eod.reviewed", params: { count: 1, items: "VID-4 Storyboard TVC" } },
      { key: "eod.handoffs", params: { count: 1, items: "SOC-12 Key visual Tết" } },
      { key: "eod.blocked", params: { count: 1, items: "SOC-15 Caption tuần 3" } },
      { key: "eod.notDone", params: { count: 1, items: "SOC-15 Caption tuần 3" } },
      { key: "eod.time", params: { hours: 6.8 } },
    ]);
  });

  it("says so when the day recorded nothing, rather than inventing a day", () => {
    expect(eodDraftLines({ done: [], notDone: [], activity: [], minutesLogged: 0 })).toEqual([{ key: "eod.nothing", params: {} }]);
  });

  it("lists five and says there is more", () => {
    const done = Array.from({ length: 7 }, (_, index) => ({ title: `Việc ${index + 1}`, ref: null }));
    expect(eodDraftLines({ done, notDone: [], activity: [], minutesLogged: 0 })[0].params.items).toBe("Việc 1; Việc 2; Việc 3; Việc 4; Việc 5; …");
  });
});

describe("statusDraftLines and suggestedHealth", () => {
  const facts = { tasksDone: 14, tasksOpen: 6, overdue: 2, blocked: 1, milestoneSlipDays: 3, nextMilestone: { name: "Bàn giao master", dueDate: "2026-11-28" }, minutesLogged: 5400, budgetMinutes: 6000, deliverablesAccepted: 4, deliverablesPromised: 9 };

  it("turns the status facts into lines — hours and counts, never a fee", () => {
    expect(statusDraftLines(facts)).toEqual([
      { key: "status.progress", params: { done: 14, open: 6 } },
      { key: "status.register", params: { accepted: 4, promised: 9 } },
      { key: "status.overdue", params: { count: 2 } },
      { key: "status.blocked", params: { count: 1 } },
      { key: "status.slip", params: { days: 3 } },
      { key: "status.nextMilestone", params: { name: "Bàn giao master", date: "2026-11-28" } },
      { key: "status.burn", params: { logged: 90, budget: 100, percent: 90 } },
    ]);
  });

  it("suggests a health from the facts, which the lead may overrule", () => {
    expect(suggestedHealth(facts)).toBe("at_risk");
    expect(suggestedHealth({ ...facts, overdue: 0, blocked: 0, milestoneSlipDays: 0, minutesLogged: 1000 })).toBe("on_track");
    expect(suggestedHealth({ ...facts, minutesLogged: 6100 })).toBe("off_track");
    expect(suggestedHealth({ ...facts, milestoneSlipDays: 10 })).toBe("off_track");
  });
});

describe("handoffDraft", () => {
  const thread = {
    title: "TVC Tết — bản dựng 30s",
    description: "Dựng bản 30s từ footage buổi quay 12/10. Nhạc đã mua bản quyền.",
    stateName: "Đang dựng",
    comments: [
      { author: "Tam", body: "Footage ở đây https://drive.google.com/drive/folders/abc123. Đã xong rough cut." },
      { author: "Huy", body: "Khách muốn logo to hơn ở cảnh cuối? Lương tháng 10 của mình khi nào về?" },
      { author: "Tam", body: "Tiếp theo cần chỉnh màu và làm 3 bản cắt ngắn. Phí thuê màu 2.000.000 đ." },
    ],
  };

  it("extracts context, state, done, next, questions and links from the thread", () => {
    expect(handoffDraft(thread)).toEqual({
      context: "TVC Tết — bản dựng 30s Dựng bản 30s từ footage buổi quay 12/10.",
      state: `Đang dựng Tam: Phí thuê màu ${REDACTED}.`,
      done: "Đã xong rough cut.",
      next: "Tiếp theo cần chỉnh màu và làm 3 bản cắt ngắn.",
      questions: "Huy: Khách muốn logo to hơn ở cảnh cuối?",
      links: ["https://drive.google.com/drive/folders/abc123"],
    });
  });

  it("never carries a sentence about pay or an amount into the note or the model's text", () => {
    const note = JSON.stringify(handoffDraft(thread));
    const text = threadText(thread);
    for (const output of [note, text]) {
      expect(output).not.toMatch(/Lương|2\.000\.000/u);
    }
  });

  it("is the same note every time", () => {
    expect(handoffDraft(thread)).toEqual(handoffDraft(thread));
  });
});
