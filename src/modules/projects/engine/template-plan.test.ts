import { describe, expect, it } from "vitest";
import { briefFromTemplate, datePlan } from "./template-plan";

describe("project templates v2 (FR-PJM-15)", () => {
  const parts = {
    phases: [
      { name: "Tiền kỳ", startDay: 0, endDay: 10 },
      { name: "Hậu kỳ", startDay: 18, endDay: 11 },
    ],
    milestones: [
      { name: "Chốt kịch bản", day: 7, phase: 0, isClientFacing: true, isBilling: false },
      { name: "Bàn giao master", day: 30, phase: 5, isClientFacing: true, isBilling: true },
    ],
    deliverables: [
      { title: "TVC 30s", quantity: 1, format: "tvc", channel: null, milestone: 1, day: 30 },
      { title: "Cut-down 6s", quantity: 0, format: "short_video", channel: "facebook", milestone: null, day: null },
    ],
    budgetByRole: [
      { role: "editor", minutes: 2400 },
      { role: "producer", minutes: 1200 },
    ],
  };
  it("dates the plan from the start", () => {
    expect(datePlan(parts, { mode: "start", date: "2026-10-01" }, 25)).toEqual({
      phases: [
        { name: "Tiền kỳ", startDate: "2026-10-01", endDate: "2026-10-11", sortOrder: 0 },
        { name: "Hậu kỳ", startDate: "2026-10-12", endDate: "2026-10-19", sortOrder: 1 },
      ],
      milestones: [
        { name: "Chốt kịch bản", dueDate: "2026-10-08", phase: 0, isClientFacing: true, isBilling: false, sortOrder: 0 },
        { name: "Bàn giao master", dueDate: "2026-10-31", phase: null, isClientFacing: true, isBilling: true, sortOrder: 1 },
      ],
      lines: [
        { title: "TVC 30s", quantity: 1, format: "tvc", channel: null, milestone: 1, dueDate: "2026-10-31", sortOrder: 0 },
        { title: "Cut-down 6s", quantity: 1, format: "short_video", channel: "facebook", milestone: null, dueDate: null, sortOrder: 1 },
      ],
      budgetMinutes: 3600,
    });
  });
  it("counts back from an end date so the last day lands on it", () => {
    const dated = datePlan(parts, { mode: "end", date: "2026-12-31" }, 25);
    expect(dated.milestones.map((milestone) => milestone.dueDate)).toEqual(["2026-12-08", "2026-12-31"]);
    // The task tree's last step is later than any plan day: it decides the shift.
    expect(datePlan(parts, { mode: "end", date: "2026-12-31" }, 40).milestones[1].dueDate).toBe("2026-12-21");
    expect(datePlan({ ...parts, budgetByRole: [] }, { mode: "start", date: "2026-10-01" }, 0).budgetMinutes).toBeNull();
  });
  it("copies the brief rather than sharing its lists", () => {
    const brief = { objective: "Ra mắt", clientContacts: [{ name: "Chị Lan", role: "Brand manager" }], links: ["https://drive.google.com/x"] };
    const copy = briefFromTemplate(brief);
    expect(copy).toEqual(brief);
    expect(copy.clientContacts).not.toBe(brief.clientContacts);
    expect(copy.links).not.toBe(brief.links);
  });
});
