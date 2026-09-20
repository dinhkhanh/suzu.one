import { describe, expect, it } from "vitest";
import type { Principal } from "../platform/rbac/policy";
import { assetReach, canConfirmHandover, canManageAssets, canManageCategories, canReadAssetMoney, canReadPersonAssets, canReadRegister, canViewAsset } from "./policy";

const SZM = "00000000-0000-4000-8000-000000000001";
const SZC = "00000000-0000-4000-8000-000000000002";
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const owner = principal("owner", [{ role: "owner", scope: { type: "group" } }]);
const keeper = principal("keeper", [{ role: "asset_admin", scope: { type: "group" } }]);
const entityKeeper = principal("entity-keeper", [{ role: "asset_admin", scope: { type: "entity", id: SZM } }]);
const hrAdmin = principal("hr-admin", [{ role: "hr_admin", scope: { type: "group" } }]);
const hrStaff = principal("hr-staff", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const finance = principal("finance", [{ role: "finance", scope: { type: "group" } }]);
const ceo = principal("ceo", [{ role: "c_level", scope: { type: "group" } }]);
const head = principal("head", [{ role: "department_head", scope: { type: "department", id: "d" } }]);
const employee = principal("employee");

const holder = (personId: string, entityId = SZM) => ({ personId, entityId, departmentId: null, teamId: null, managerId: "head" });

describe("asset policy", () => {
  it("reads the register on asset:manage over the entity, and nothing else does", () => {
    expect(canReadRegister(owner, SZM)).toBe(true);
    expect(canReadRegister(keeper, SZC)).toBe(true);
    expect(canReadRegister(entityKeeper, SZM)).toBe(true);
    expect(canReadRegister(entityKeeper, SZC)).toBe(false);
    // The permission is not in the HR, finance or executive roles as the catalogue stands.
    for (const who of [hrAdmin, hrStaff, finance, ceo, head, employee]) expect(canReadRegister(who, SZM)).toBe(false);
  });

  it("navigation: anyone who keeps a register somewhere", () => {
    expect([owner, keeper, entityKeeper].every((who) => canReadRegister(who))).toBe(true);
    expect([hrAdmin, finance, ceo, employee].some((who) => canReadRegister(who))).toBe(false);
  });

  it("managing the register is the same authority as reading it", () => {
    expect(canManageAssets(entityKeeper, SZM)).toBe(true);
    expect(canManageAssets(entityKeeper, SZC)).toBe(false);
    expect(canManageAssets(hrAdmin, SZM)).toBe(false);
  });

  it("the category library is group-wide: an entity's keeper does not change it", () => {
    expect(canManageCategories(owner)).toBe(true);
    expect(canManageCategories(keeper)).toBe(true);
    expect(canManageCategories(entityKeeper)).toBe(false);
  });

  // The decision this module is asked to defend: an asset's price is not public, and holding the
  // thing tells you nothing about what it cost.
  describe("what the thing cost", () => {
    it("is read by whoever keeps the register or reads the entity's reports", () => {
      expect(canReadAssetMoney(owner, SZM)).toBe(true);
      expect(canReadAssetMoney(entityKeeper, SZM)).toBe(true);
      expect(canReadAssetMoney(finance, SZM)).toBe(true);
      expect(canReadAssetMoney(ceo, SZM)).toBe(true);
      expect(canReadAssetMoney(hrAdmin, SZM)).toBe(true); // hr_admin holds report:read
    });

    it("is not read by the person holding it, nor by anyone else", () => {
      expect(canReadAssetMoney(employee, SZM)).toBe(false);
      expect(canReadAssetMoney(head, SZM)).toBe(false);
      expect(canReadAssetMoney(entityKeeper, SZC)).toBe(false);
      // Reading the money is strictly narrower than nothing else: a holder may open their asset…
      expect(canViewAsset(employee, { entityId: SZM }, "employee")).toBe(true);
      // …and still not see its price.
      expect(canReadAssetMoney(employee, SZM)).toBe(false);
    });
  });

  it("opens one asset for the register's readers and for whoever is holding it", () => {
    expect(canViewAsset(entityKeeper, { entityId: SZM }, null)).toBe(true);
    expect(canViewAsset(employee, { entityId: SZM }, "employee")).toBe(true);
    expect(canViewAsset(employee, { entityId: SZM }, "somebody-else")).toBe(false);
    expect(canViewAsset(employee, { entityId: SZM }, null)).toBe(false);
    expect(canViewAsset(head, { entityId: SZM }, "employee")).toBe(false);
  });

  it("shows what one person holds to themselves, to the register and to whoever keeps their record", () => {
    expect(canReadPersonAssets(employee, holder("employee"))).toBe(true);
    expect(canReadPersonAssets(entityKeeper, holder("someone"))).toBe(true);
    // HR keeps the record, so HR sees the equipment — which is what makes offboarding work at all.
    expect(canReadPersonAssets(hrStaff, holder("someone", SZM))).toBe(true);
    expect(canReadPersonAssets(hrStaff, holder("someone", SZC))).toBe(false);
    expect(canReadPersonAssets(employee, holder("someone"))).toBe(false);
    expect(canReadPersonAssets(head, holder("someone"))).toBe(false);
  });

  it("lets only the holder confirm their own handover — never the storekeeper on their behalf", () => {
    expect(canConfirmHandover(employee, "employee")).toBe(true);
    expect(canConfirmHandover(keeper, "employee")).toBe(false);
    expect(canConfirmHandover(owner, "employee")).toBe(false);
    // A team's or an office's asset has nobody to confirm.
    expect(canConfirmHandover(employee, null)).toBe(false);
  });

  it("reaches the entities whose registers it keeps", () => {
    expect(assetReach(owner)).toEqual({ all: true });
    expect(assetReach(keeper)).toEqual({ all: true });
    expect(assetReach(entityKeeper)).toEqual({ all: false, entityIds: [SZM] });
    expect(assetReach(employee)).toEqual({ all: false, entityIds: [] });
  });
});
