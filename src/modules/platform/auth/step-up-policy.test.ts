import { describe, expect, it } from "vitest";
import { stepUpDriverProblem } from "@/lib/env";
import { checkStepUpClaims, isStepUpFresh, safeNextPath, STEP_UP_WINDOW_MINUTES } from "./step-up-policy";

const now = new Date("2026-09-20T03:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

describe("isStepUpFresh", () => {
  it("accepts a proof inside the window and refuses everything else", () => {
    expect(isStepUpFresh(minutesAgo(1), now)).toBe(true);
    expect(isStepUpFresh(minutesAgo(STEP_UP_WINDOW_MINUTES), now)).toBe(true);
    expect(isStepUpFresh(minutesAgo(STEP_UP_WINDOW_MINUTES + 1), now)).toBe(false);
    expect(isStepUpFresh(null, now)).toBe(false);
    expect(isStepUpFresh(undefined, now)).toBe(false);
    expect(isStepUpFresh(new Date("nonsense"), now)).toBe(false);
  });

  it("refuses a timestamp from the future", () => {
    expect(isStepUpFresh(new Date(now.getTime() + 10 * 60_000), now)).toBe(false);
  });
});

describe("the local driver cannot exist in production", () => {
  it("is refused in a production build and anywhere on Vercel", () => {
    expect(stepUpDriverProblem({ driver: "local", nodeEnv: "production", vercelEnv: undefined })).toMatch(/production/);
    expect(stepUpDriverProblem({ driver: "local", nodeEnv: "development", vercelEnv: "preview" })).toMatch(/Vercel/);
    expect(stepUpDriverProblem({ driver: "local", nodeEnv: "production", vercelEnv: "production" })).not.toBeNull();
  });

  it("is allowed on a development machine, and google is allowed everywhere", () => {
    expect(stepUpDriverProblem({ driver: "local", nodeEnv: "development", vercelEnv: undefined })).toBeNull();
    expect(stepUpDriverProblem({ driver: "local", nodeEnv: "test", vercelEnv: undefined })).toBeNull();
    expect(stepUpDriverProblem({ driver: "google", nodeEnv: "production", vercelEnv: "production" })).toBeNull();
  });
});

describe("safeNextPath", () => {
  it("keeps in-app paths and drops anything that could leave the site or loop", () => {
    expect(safeNextPath("/payroll/salaries?entity=1")).toBe("/payroll/salaries?entity=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "payroll", "", null, "/step-up?next=/x", "/api/step-up/start", "/a\nb"]) expect(safeNextPath(bad)).toBe("/home");
  });
});

describe("checkStepUpClaims", () => {
  const seconds = Math.floor(now.getTime() / 1000);
  const expected = { clientId: "client-1", email: "An.Tran@suzu.vn", nonce: "n-1" };
  const good = { iss: "https://accounts.google.com", aud: "client-1", exp: seconds + 3000, iat: seconds - 5, auth_time: seconds - 10, email: "an.tran@suzu.vn", email_verified: true, nonce: "n-1" };

  it("accepts a fresh sign-in of the same account", () => {
    expect(checkStepUpClaims(good, expected, now)).toEqual({ ok: true });
  });

  it("falls back to the issue time when Google sends no auth_time", () => {
    expect(checkStepUpClaims({ ...good, auth_time: undefined }, expected, now)).toEqual({ ok: true });
  });

  it.each([
    ["issuer", { iss: "https://evil.example" }],
    ["audience", { aud: "someone-else" }],
    ["expired", { exp: seconds - 1 }],
    ["nonce", { nonce: "replayed" }],
    ["different_account", { email: "other@suzu.vn" }],
    ["different_account", { email_verified: false }],
    ["not_recent", { auth_time: seconds - 3600 }],
    ["not_recent", { auth_time: seconds + 3600 }],
  ])("refuses: %s", (reason, change) => {
    expect(checkStepUpClaims({ ...good, ...change }, expected, now)).toEqual({ ok: false, reason });
  });
});
