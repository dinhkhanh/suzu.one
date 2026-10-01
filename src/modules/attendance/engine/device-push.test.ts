import { describe, expect, it } from "vitest";
import { futureRows, PUSH_BATCH_LIMIT, pushBodySchema, pushedRows, vietnamLocal } from "./device-push";

describe("pushed device punches", () => {
  it("reads moments with any offset as Vietnam local time", () => {
    const body = pushBodySchema.parse({ punches: [{ userId: " SZM-0004 ", at: "2026-10-01T08:42:13+07:00" }, { userId: "17", at: "2026-10-01T10:05:00Z", direction: "out" }, { userId: "17", at: "2026-10-01T23:30:00.250+07:00", direction: null }] });
    expect(pushedRows(body)).toEqual([
      { row: 1, values: { deviceUserId: "SZM-0004", at: "2026-10-01 08:42:13", direction: null } },
      { row: 2, values: { deviceUserId: "17", at: "2026-10-01 17:05:00", direction: "out" } },
      { row: 3, values: { deviceUserId: "17", at: "2026-10-01 23:30:00", direction: null } },
    ]);
  });
  it("crosses midnight on the Vietnam clock, not UTC's", () => {
    expect(vietnamLocal(new Date("2026-09-30T18:15:00Z"))).toBe("2026-10-01 01:15:00");
  });
  it("refuses a moment without an offset, an empty ID and an oversized batch", () => {
    expect(pushBodySchema.safeParse({ punches: [{ userId: "17", at: "2026-10-01 08:42:13" }] }).success).toBe(false);
    expect(pushBodySchema.safeParse({ punches: [{ userId: "  ", at: "2026-10-01T08:42:13+07:00" }] }).success).toBe(false);
    expect(pushBodySchema.safeParse({ punches: Array.from({ length: PUSH_BATCH_LIMIT + 1 }, () => ({ userId: "17", at: "2026-10-01T08:42:13+07:00" })) }).success).toBe(false);
  });
  it("accepts an empty batch: a heartbeat", () => {
    expect(pushedRows(pushBodySchema.parse({ punches: [] }))).toEqual([]);
  });
  it("finds rows stamped more than an hour ahead", () => {
    const rows = pushedRows(pushBodySchema.parse({ punches: [{ userId: "17", at: "2026-10-01T09:59:00+07:00" }, { userId: "17", at: "2026-10-01T10:01:00+07:00" }] }));
    expect(futureRows(rows, new Date("2026-10-01T09:00:00+07:00"))).toEqual([2]);
  });
});
