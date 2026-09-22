import { describe, expect, it } from "vitest";
import { reportFigures, reportText, type ReportWords } from "./client-report";

const input = {
  lines: [
    { title: "Bài đăng Facebook", promised: 12, accepted: 10, delivered: 9 },
    { title: "Video TikTok", promised: 4, accepted: 4, delivered: 4 },
  ],
  publishes: [
    { platform: "facebook", url: "https://fb.com/1", publishedOn: "2026-10-05", title: "Post 1", metrics: { reach: 1000, engagement: 50 } },
    { platform: "tiktok", url: null, publishedOn: "2026-10-12", title: "Clip 1", metrics: { views: 5000 } },
    { platform: "facebook", url: "https://fb.com/0", publishedOn: "2026-09-28", title: "Old", metrics: { reach: 99_999 } },
  ],
  milestones: [
    { name: "Duyệt kế hoạch", doneOn: "2026-10-02" },
    { name: "Tháng 9", doneOn: "2026-09-30" },
  ],
  updates: [{ on: "2026-10-15", health: "on_track", summary: "Đúng lịch" }],
  hours: { loggedMinutes: 6000, billableMinutes: 4800 },
};
const october = { from: "2026-10-01", to: "2026-10-31" };

describe("client report (FR-PJM-58)", () => {
  it("counts the period's register, publishing, milestones and updates", () => {
    const figures = reportFigures(input, october, { showHours: false });
    expect(figures.register).toEqual({ promised: 16, accepted: 14, delivered: 13, percent: 87 });
    expect(figures.publishing).toEqual({ count: 2, byPlatform: { facebook: 1, tiktok: 1 }, totals: { reach: 1000, views: 5000, engagement: 50, clicks: 0 } });
    expect(figures.milestones.map((row) => row.name)).toEqual(["Duyệt kế hoạch"]);
    expect(figures.updates).toHaveLength(1);
  });

  it("leaves internal hours out unless the author asks for them — and never has a fee to show", () => {
    expect(reportFigures(input, october, { showHours: false })).not.toHaveProperty("hours");
    expect(reportFigures(input, october, { showHours: true }).hours).toEqual({ loggedMinutes: 6000, billableMinutes: 4800 });
    expect(JSON.stringify(reportFigures(input, october, { showHours: true }))).not.toMatch(/fee|Vnd/i);
  });

  it("writes the figures out as the PDF body", () => {
    const words: ReportWords = {
      period: "Kỳ",
      summary: "Tóm tắt",
      register: "Sản phẩm",
      registerLine: (line) => `${line.title}: ${line.accepted}/${line.promised}`,
      registerTotal: (register) => `${register.accepted}/${register.promised}`,
      publishing: "Đăng tải",
      publishingTotal: (publishing) => `${publishing.count} bài`,
      milestones: "Mốc",
      updates: "Cập nhật",
      hours: (hours) => `Giờ: ${hours.loggedMinutes / 60}`,
      nextPlan: "Kế hoạch",
      none: "—",
      platform: (platform) => platform,
      health: (health) => health,
      date: (date) => date.split("-").reverse().join("/"),
    };
    const text = reportText({ periodFrom: october.from, periodTo: october.to, summary: "Tháng tốt", nextPlan: null }, reportFigures(input, october, { showHours: false }), words);
    expect(text).toContain("Kỳ: 01/10/2026 – 31/10/2026");
    expect(text).toContain("SẢN PHẨM\n14/16\n- Bài đăng Facebook: 10/12");
    expect(text).toContain("- 05/10/2026 · facebook · Post 1 · https://fb.com/1");
    expect(text).toContain("KẾ HOẠCH\n—");
    expect(text).not.toContain("Giờ");
  });
});
