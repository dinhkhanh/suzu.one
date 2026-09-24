import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "../rbac/policy";
import { IMPERSONATION_MAX_HOURS, impersonatedReauthAt, isImpersonationLive } from "./impersonation-policy";

const now = new Date("2026-09-24T09:00:00+07:00");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

describe("isImpersonationLive", () => {
  it("lasts the working day and no longer", () => {
    expect(isImpersonationLive(hoursAgo(0.5), now)).toBe(true);
    expect(isImpersonationLive(hoursAgo(IMPERSONATION_MAX_HOURS - 0.01), now)).toBe(true);
    expect(isImpersonationLive(hoursAgo(IMPERSONATION_MAX_HOURS + 0.01), now)).toBe(false);
  });

  it("is off without a start, with a broken one, or with one from the future", () => {
    expect(isImpersonationLive(null, now)).toBe(false);
    expect(isImpersonationLive(new Date("nonsense"), now)).toBe(false);
    expect(isImpersonationLive(hoursAgo(-1), now)).toBe(false);
  });
});

describe("impersonatedReauthAt", () => {
  const proof = hoursAgo(0.1);
  const principal = (grants: Grant[]): Principal => ({ personId: "me", workforceType: "employee", grants });
  const lan = { personId: "lan", entityId: "entity-a", unitPath: ["dept-design"], managerId: "boss", grants: [] };

  it("travels with the owner and with C&B over the target's entity", () => {
    expect(impersonatedReauthAt(principal([{ role: "owner", scope: { type: "group" } }]), lan, proof)).toBe(proof);
    expect(impersonatedReauthAt(principal([{ role: "payroll", scope: { type: "entity", id: "entity-a" } }]), lan, proof)).toBe(proof);
  });

  it("stays behind for a support person, a line manager, or C&B of another entity", () => {
    expect(impersonatedReauthAt(principal([{ role: "support", scope: { type: "group" } }]), lan, proof)).toBeNull();
    expect(impersonatedReauthAt({ ...principal([{ role: "support", scope: { type: "group" } }]), personId: "boss" }, lan, proof)).toBeNull();
    expect(impersonatedReauthAt(principal([{ role: "payroll", scope: { type: "entity", id: "entity-b" } }]), lan, proof)).toBeNull();
  });
});
