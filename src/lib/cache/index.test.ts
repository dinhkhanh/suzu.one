import { expect, it } from "vitest";
import { secondsUntilVietnamMidnight } from "./index";

it("counts down to midnight in Vietnam (UTC+7), never below a minute", () => {
  expect(secondsUntilVietnamMidnight(new Date("2026-09-22T17:00:00Z"))).toBe(86_400);
  expect(secondsUntilVietnamMidnight(new Date("2026-09-22T16:00:00Z"))).toBe(3_600);
  expect(secondsUntilVietnamMidnight(new Date("2026-09-22T16:59:59Z"))).toBe(60);
});
