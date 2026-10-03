import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "../platform/rbac/policy";
import { canManageAnyBrandKit, canManageBrandKit } from "./policy";

const principal = (grants: Grant[]): Principal => ({ personId: "p", workforceType: "employee", grants });
const SZM = "entity-szm";
const SZC = "entity-szc";

describe("who keeps a brand kit", () => {
  it("is marketing over the kit's company, or over the whole group", () => {
    const entityMarketing = principal([{ role: "marketing", scope: { type: "entity", id: SZM } }]);
    expect(canManageBrandKit(entityMarketing, { entityId: SZM })).toBe(true);
    expect(canManageBrandKit(entityMarketing, { entityId: SZC })).toBe(false);
    // A brand of the whole group needs a group grant.
    expect(canManageBrandKit(entityMarketing, { entityId: null })).toBe(false);
    expect(canManageBrandKit(principal([{ role: "marketing", scope: { type: "group" } }]), { entityId: null })).toBe(true);
    expect(canManageBrandKit(principal([{ role: "owner", scope: { type: "group" } }]), { entityId: SZC })).toBe(true);
  });

  it("is nobody else — not HR, not a director, not an employee", () => {
    for (const role of ["hr_admin", "entity_director", "c_level", "asset_admin", "sales", "recruiter"] as const) {
      const someone = principal([{ role, scope: { type: "group" } }]);
      expect(canManageBrandKit(someone, { entityId: SZM }), role).toBe(false);
      expect(canManageAnyBrandKit(someone), role).toBe(false);
    }
    expect(canManageAnyBrandKit(principal([]))).toBe(false);
  });
});
