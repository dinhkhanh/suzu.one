// An entity's paying bank accounts (FR-PLT-11, FR-PAY-33): who may see and keep them, and that
// there is always exactly one default per bank while any account at that bank is in use.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
}));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import type { Grant, Principal } from "../rbac/policy";
import { PAYING_BANK_KEYS } from "./enums";
import { canKeepEntityBankAccounts, canSeeEntityBankAccounts } from "./policy";
import { listEntityBankAccounts, saveEntityBankAccount } from "./service";

const ids = {} as Record<"szm" | "szc", string>;
const account = (over: Partial<Parameters<typeof saveEntityBankAccount>[2]> = {}) => ({ bank: "vcb", accountNumber: "0071000123456", accountName: "CONG TY TNHH SUZU MEDIA", branch: null, isDefault: false, isActive: true, ...over });
const defaults = async (entityId: string, bank: string) => (await listEntityBankAccounts(entityId)).filter((row) => row.bank === bank && row.isDefault).map((row) => row.accountNumber);

beforeAll(async () => {
  await migrateTestDb();
  const entities = await db()
    .insert(schema.entity)
    .values([
      { code: "SZM", legalName: "SuZu Media", shortName: "Media" },
      { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" },
    ])
    .returning();
  ids.szm = entities[0].id;
  ids.szc = entities[1].id;
});

describe("who may see and keep an entity's paying accounts", () => {
  const principal = (grants: Grant[]): Principal => ({ personId: crypto.randomUUID(), workforceType: "employee", grants });
  const over = (role: Grant["role"], entityId: string) => principal([{ role, scope: { type: "entity", id: entityId } }]);
  const SZM = "entity-szm";
  const SZC = "entity-szc";

  it("lets the entity's administrator and its chief accountant keep them — either one", () => {
    // hr_admin holds org:manage; finance holds payroll:pay.
    expect(canKeepEntityBankAccounts(over("hr_admin", SZM), SZM)).toBe(true);
    expect(canKeepEntityBankAccounts(over("finance", SZM), SZM)).toBe(true);
    expect(canKeepEntityBankAccounts(principal([{ role: "owner", scope: { type: "group" } }]), SZM)).toBe(true);
  });

  it("refuses everyone else, and another entity's accountant", () => {
    for (const role of ["c_level", "payroll", "auditor", "hr_staff", "entity_director", "department_head"] as const) expect({ role, keeps: canKeepEntityBankAccounts(over(role, SZM), SZM) }).toEqual({ role, keeps: false });
    expect(canKeepEntityBankAccounts(over("finance", SZC), SZM)).toBe(false);
    expect(canKeepEntityBankAccounts(principal([]), SZM)).toBe(false);
  });

  it("shows them to the keepers and to payroll readers, not to everybody who can open the entity", () => {
    for (const role of ["hr_admin", "finance", "c_level", "payroll", "auditor"] as const) expect({ role, sees: canSeeEntityBankAccounts(over(role, SZM), SZM) }).toEqual({ role, sees: true });
    // org:read alone — HR staff, a director, a recruiter — opens the entity's page without them.
    for (const role of ["hr_staff", "entity_director", "recruiter"] as const) expect({ role, sees: canSeeEntityBankAccounts(over(role, SZM), SZM) }).toEqual({ role, sees: false });
    expect(canSeeEntityBankAccounts(over("payroll", SZC), SZM)).toBe(false);
  });
});

describe("keeping the accounts", () => {
  it("takes only the banks the group pays from", async () => {
    expect([...PAYING_BANK_KEYS].sort()).toEqual(["acb", "vcb"]);
    await expect(saveEntityBankAccount(ids.szm, null, account({ bank: "techcombank" }))).rejects.toThrow("bank_unknown");
    await expect(saveEntityBankAccount(ids.szm, null, account({ accountNumber: "12AB" }))).rejects.toThrow("bank_account_number_invalid");
    await expect(saveEntityBankAccount(crypto.randomUUID(), null, account())).rejects.toThrow("not_found");
  });

  it("stores the number as digits, and makes the first account at a bank its default", async () => {
    const { before, after } = await saveEntityBankAccount(ids.szm, null, account({ accountNumber: "0071 000-123 456", branch: "  CN TP.HCM " }));
    expect(before).toBeNull();
    expect(after.accountNumber).toBe("0071000123456");
    expect(after.branch).toBe("CN TP.HCM");
    // Nobody ticked "default": it is the only one, so it is the one offered.
    expect(after.isDefault).toBe(true);
  });

  it("refuses the same account twice for one entity, and allows it for another", async () => {
    await expect(saveEntityBankAccount(ids.szm, null, account({ accountNumber: "0071-000-123-456" }))).rejects.toThrow("bank_account_exists");
    const { after } = await saveEntityBankAccount(ids.szc, null, account());
    expect(after.entityId).toBe(ids.szc);
  });

  it("moves the default when another account takes it, one bank at a time", async () => {
    const { after: second } = await saveEntityBankAccount(ids.szm, null, account({ accountNumber: "0071000999888" }));
    expect(second.isDefault).toBe(false);
    const { after: acb } = await saveEntityBankAccount(ids.szm, null, account({ bank: "acb", accountNumber: "123456789" }));
    expect(acb.isDefault).toBe(true);

    await saveEntityBankAccount(ids.szm, second.id, { ...account({ accountNumber: second.accountNumber }), isDefault: true });
    expect(await defaults(ids.szm, "vcb")).toEqual(["0071000999888"]);
    // The other bank's default, and the other entity's, were not touched.
    expect(await defaults(ids.szm, "acb")).toEqual(["123456789"]);
    expect(await defaults(ids.szc, "vcb")).toEqual(["0071000123456"]);
  });

  it("passes the default on when the default account is switched off", async () => {
    const [current] = (await listEntityBankAccounts(ids.szm)).filter((row) => row.bank === "vcb" && row.isDefault);
    await saveEntityBankAccount(ids.szm, current.id, { ...account({ accountNumber: current.accountNumber }), isDefault: true, isActive: false });
    expect(await defaults(ids.szm, "vcb")).toEqual(["0071000123456"]);

    // Switched-off accounts stay listed for the administrator and are left out for the bank-file screen.
    expect((await listEntityBankAccounts(ids.szm)).filter((row) => row.bank === "vcb")).toHaveLength(2);
    expect((await listEntityBankAccounts(ids.szm, { activeOnly: true })).filter((row) => row.bank === "vcb").map((row) => row.accountNumber)).toEqual(["0071000123456"]);
  });

  it("lists an entity's accounts bank by bank, the default first", async () => {
    await saveEntityBankAccount(ids.szm, null, account({ accountNumber: "0001112223" }));
    expect((await listEntityBankAccounts(ids.szm, { activeOnly: true })).map((row) => [row.bank, row.accountNumber, row.isDefault])).toEqual([
      ["acb", "123456789", true],
      ["vcb", "0071000123456", true],
      ["vcb", "0001112223", false],
    ]);
  });
});
