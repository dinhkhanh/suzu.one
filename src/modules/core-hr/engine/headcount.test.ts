import { describe, expect, it } from "vitest";
import { ageBand, countBy, employedOn, headcountSnapshot, movement, seniorityBand, type Span, yearsBetween } from "./headcount";

const span = (personId: string, startDate: string, endDate: string | null, more: Partial<Span> = {}): Span => ({ personId, startDate, endDate, seniorityDate: startDate, entity: "Media", department: "Video", workforceType: "employee", gender: "female", dateOfBirth: "1995-06-15", ...more });

describe("bands", () => {
  it("counts whole years the way birthdays do", () => {
    expect(yearsBetween("1995-06-15", "2026-06-14")).toBe(30);
    expect(yearsBetween("1995-06-15", "2026-06-15")).toBe(31);
    expect(yearsBetween("2024-02-29", "2025-02-28")).toBe(0);
  });
  it("puts ages and seniority on the band edges correctly", () => {
    expect(["2001-10-01", "2001-09-30", "1991-09-30", "1971-09-30", null].map((dob) => ageBand(dob, "2026-09-30"))).toEqual(["under_25", "25_34", "35_44", "55_plus", "unknown"]);
    expect(["2026-01-01", "2025-09-30", "2023-09-30", "2021-09-30", "2016-09-30"].map((date) => seniorityBand(date, "2026-09-30"))).toEqual(["under_1", "1_3", "3_5", "5_10", "10_plus"]);
  });
});

describe("headcountSnapshot", () => {
  const spans = [
    span("a", "2020-01-01", null),
    span("b", "2023-03-01", "2026-09-30", { department: "Design", gender: "male" }),
    span("c", "2026-10-01", null, { workforceType: "probation" }),
    span("d", "2019-01-01", "2026-08-31", { entity: "Creative" }),
    span("e", "2026-09-01", null, { department: null, gender: null, dateOfBirth: null, workforceType: "collaborator" }),
  ];
  it("counts who is on the books that day: the last day counts, future starters and leavers do not", () => {
    expect(employedOn(spans[1], "2026-09-30")).toBe(true);
    expect(employedOn(spans[1], "2026-10-01")).toBe(false);
    const snapshot = headcountSnapshot(spans, "2026-09-30");
    expect(snapshot.total).toBe(3);
    expect(snapshot.byDepartment).toEqual([{ key: "Design", count: 1 }, { key: "unknown", count: 1 }, { key: "Video", count: 1 }]);
    expect(snapshot.byWorkforceType).toEqual([{ key: "collaborator", count: 1 }, { key: "employee", count: 2 }].sort((x, y) => y.count - x.count));
    expect(snapshot.byGender).toEqual([{ key: "female", count: 1 }, { key: "male", count: 1 }, { key: "unknown", count: 1 }]);
    expect(snapshot.byAge).toEqual([{ key: "25_34", count: 2 }, { key: "unknown", count: 1 }]);
    expect(snapshot.bySeniority).toEqual([{ key: "under_1", count: 1 }, { key: "3_5", count: 1 }, { key: "5_10", count: 1 }]);
  });
  it("keeps band order and drops empty bands", () => {
    expect(countBy(["b", "a", "b"], (value) => value, ["a", "b", "c"])).toEqual([{ key: "a", count: 1 }, { key: "b", count: 2 }]);
  });
});

describe("movement", () => {
  it("counts joiners, leavers and turnover over the average headcount", () => {
    const spans = [
      span("stays", "2020-01-01", null),
      span("stays-2", "2021-01-01", null),
      span("leaves-last-day-of-period", "2022-01-01", "2026-09-30", { department: "Design" }),
      span("left-before", "2019-01-01", "2026-08-31"),
      span("joins", "2026-09-15", null),
      span("joins-and-leaves", "2026-09-02", "2026-09-20"),
      span("joins-after", "2026-10-01", null),
    ];
    const result = movement(spans, "2026-09-01", "2026-09-30");
    // Opening (31 Aug): stays, stays-2, leaves…, left-before = 4. Closing (after 30 Sep): stays, stays-2, joins = 3.
    expect(result).toMatchObject({ opening: 4, closing: 3, joiners: 2, leavers: 2 });
    // 2 ÷ 3.5 = 57.14%
    expect(result.turnoverBp).toBe(5714);
    expect(result.leaversByDepartment).toEqual([{ key: "Design", count: 1 }, { key: "Video", count: 1 }]);
  });
  it("has no turnover rate when nobody was employed", () => {
    expect(movement([], "2026-01-01", "2026-01-31").turnoverBp).toBeNull();
  });
});
