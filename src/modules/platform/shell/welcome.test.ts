import { describe, expect, it } from "vitest";
import { shouldShowWelcome, welcomeSteps } from "./welcome";

describe("welcomeSteps", () => {
  it("walks an employee through their pages in order, between the opening and the confirmation", () => {
    const nav = new Map([
      ["kb", "/kb"],
      ["today", "/today"],
      ["checkIn", "/attendance/check-in"],
      ["me", "/me"],
      ["leave", "/leave"],
      ["tasks", "/tasks"],
      ["daily", "/daily"],
      ["payslips", "/payslips"],
      ["people", "/people"],
    ]);
    expect(welcomeSteps(nav).map((step) => step.key)).toEqual(["welcome", "today", "checkIn", "me", "leave", "tasks", "daily", "payslips", "kb", "finish"]);
    expect(welcomeSteps(nav).find((step) => step.key === "checkIn")?.href).toBe("/attendance/check-in");
  });

  it("leaves out a page the person has no entry for", () => {
    const steps = welcomeSteps(new Map([["today", "/today"], ["me", "/me"]]));
    expect(steps.map((step) => step.key)).toEqual(["welcome", "today", "me", "finish"]);
  });
});

describe("shouldShowWelcome", () => {
  it("opens for someone who has not confirmed the guide", () => {
    expect(shouldShowWelcome({ completedAt: null, sessionId: "s1", laterCookie: undefined })).toBe(true);
  });

  it("stays shut for the rest of the session that put it off", () => {
    expect(shouldShowWelcome({ completedAt: null, sessionId: "s1", laterCookie: "s1" })).toBe(false);
  });

  it("opens again at the next sign-in", () => {
    expect(shouldShowWelcome({ completedAt: null, sessionId: "s2", laterCookie: "s1" })).toBe(true);
  });

  it("never opens once confirmed", () => {
    expect(shouldShowWelcome({ completedAt: new Date(), sessionId: "s1", laterCookie: undefined })).toBe(false);
  });
});
