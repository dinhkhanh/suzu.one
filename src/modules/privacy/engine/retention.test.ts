import { describe, expect, it } from "vitest";
import { anonymisationDueOn, cutoffBefore, GPS_NOTICE_VERSION, gpsConsentState } from "./retention";

describe("anonymisationDueOn", () => {
  it("is the day after the period ends", () => {
    expect(anonymisationDueOn("2022-06-30")).toBe("2025-07-01");
    expect(anonymisationDueOn("2023-12-31", 1)).toBe("2025-01-01");
  });

  it("counts 29 February to 28 February, as Postgres does", () => {
    expect(anonymisationDueOn("2024-02-29")).toBe("2027-03-01");
    expect(anonymisationDueOn("2024-02-29", 4)).toBe("2028-03-01");
  });
});

describe("cutoffBefore", () => {
  it("goes back whole days", () => {
    expect(cutoffBefore(new Date("2026-10-05T00:00:00Z"), 90).toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });
});

describe("gpsConsentState", () => {
  it("reads the latest answer to the current notice", () => {
    expect(gpsConsentState(null)).toBe("unanswered");
    expect(gpsConsentState({ decision: "given", noticeVersion: GPS_NOTICE_VERSION })).toBe("given");
    expect(gpsConsentState({ decision: "declined", noticeVersion: GPS_NOTICE_VERSION })).toBe("declined");
  });

  it("asks again after the wording changed, but a withdrawal stands whatever the version", () => {
    expect(gpsConsentState({ decision: "given", noticeVersion: "gps-2020-01" })).toBe("unanswered");
    expect(gpsConsentState({ decision: "declined", noticeVersion: "gps-2020-01" })).toBe("unanswered");
    expect(gpsConsentState({ decision: "withdrawn", noticeVersion: null })).toBe("withdrawn");
  });
});
