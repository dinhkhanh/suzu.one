import { describe, expect, it } from "vitest";
import { durationText, hoursOf, parseCellDuration, parseDuration, percentOf } from "./format";

describe("durations typed on a phone", () => {
  it("reads hours and minutes the way people write them", () => {
    expect(parseDuration("1h30")).toBe(90);
    expect(parseDuration("1g30")).toBe(90);
    expect(parseDuration("2:15")).toBe(135);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1,5 giờ")).toBe(90);
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("45m")).toBe(45);
    expect(parseDuration("20 phút")).toBe(20);
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
  });
  it("shows hours with one decimal", () => {
    expect(hoursOf(90)).toBe("1.5");
    expect(hoursOf(45)).toBe("0.8");
    expect(hoursOf(480)).toBe("8");
  });
});

describe("the week grid's cells", () => {
  it("reads a bare number as hours, up to a day", () => {
    expect(parseCellDuration("2")).toBe(120);
    expect(parseCellDuration("1.5")).toBe(90);
    expect(parseCellDuration("1,25")).toBe(75);
    expect(parseCellDuration("90")).toBe(90);
    expect(parseCellDuration("1h30")).toBe(90);
    expect(parseCellDuration("45m")).toBe(45);
    expect(parseCellDuration("")).toBe(0);
    expect(parseCellDuration("x")).toBeNull();
  });
  it("shows what it reads back", () => {
    for (const minutes of [45, 60, 90, 125, 480]) expect(parseCellDuration(durationText(minutes))).toBe(minutes);
    expect(durationText(0)).toBe("");
    expect(durationText(90)).toBe("1h30");
    expect(percentOf(0.756)).toBe("76");
    expect(percentOf(null)).toBeNull();
  });
});
