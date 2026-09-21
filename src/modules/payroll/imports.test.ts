// The two payroll imports carry people's pay in a spreadsheet (FR-PAY-35, FR-PAY-38), so both of
// their steps are compensation-tier actions: C&B over the entity, and a recent re-authentication
// (FR-PLT-06). This pins that down — the import framework builds the actions, so nothing in the
// pages would fail if the flag were dropped.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: () => ({}), schema: {} }));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: [], bootstrapOwnerEmails: [] }) }));
vi.mock("@/modules/core-hr/service", () => ({ listPayrollFacts: async () => [] }));

import type { Principal } from "@/modules/platform/rbac/policy";
import { parallelColumns, parallelImport } from "./parallel-import";
import { ytdColumns, ytdImport } from "./ytd-import";

const principal = (grants: Principal["grants"]): Principal => ({ personId: "p1", workforceType: "employee", grants });
const user = (grants: Principal["grants"]) => ({ principal: principal(grants), person: { id: "p1" } }) as never;

const OTHER = "entity-b";
const SZM = "entity-a";

describe("payroll imports", () => {
  it("asks for a recent re-authentication on both steps", () => {
    for (const definition of [parallelImport, ytdImport]) {
      expect(definition.definition.stepUp, definition.definition.kind).toBe(true);
    }
  });

  it("is refused to everyone but C&B over that entity", async () => {
    const cases: { grants: Principal["grants"]; allowed: boolean; who: string }[] = [
      { who: "owner", grants: [{ role: "owner", scope: { type: "group" } }], allowed: true },
      { who: "group C&B", grants: [{ role: "payroll", scope: { type: "group" } }], allowed: true },
      { who: "C&B of this entity", grants: [{ role: "payroll", scope: { type: "entity", id: SZM } }], allowed: true },
      { who: "C&B of another entity", grants: [{ role: "payroll", scope: { type: "entity", id: OTHER } }], allowed: false },
      { who: "CEO", grants: [{ role: "c_level", scope: { type: "group" } }], allowed: false },
      { who: "chief accountant", grants: [{ role: "finance", scope: { type: "group" } }], allowed: false },
      { who: "HR staff", grants: [{ role: "hr_staff", scope: { type: "entity", id: SZM } }], allowed: false },
      { who: "department head", grants: [{ role: "department_head", scope: { type: "unit", id: "d1" } }], allowed: false },
      { who: "an employee", grants: [], allowed: false },
    ];

    for (const row of cases) {
      expect(await parallelImport.definition.authorize(user(row.grants), { entityId: SZM, month: "2026-08" }), `${row.who} / parallel`).toBe(row.allowed);
      expect(await ytdImport.definition.authorize(user(row.grants), { entityId: SZM, year: 2026 }), `${row.who} / ytd`).toBe(row.allowed);
    }
  });

  it("refuses a file that names no entity at all", async () => {
    // The wizard posts the entity as a hidden field; without it there is nothing to authorize against.
    expect(await parallelImport.definition.authorize(user([{ role: "owner", scope: { type: "group" } }]), undefined)).toBe(false);
    expect(await ytdImport.definition.authorize(user([{ role: "owner", scope: { type: "group" } }]), undefined)).toBe(false);
  });

  it("marks every money column as sensitive, so a staged batch waits encrypted", () => {
    const money = ["gross", "employeeInsurance", "unionDues", "pit", "otherDeductions", "net"] as const;
    for (const column of money) expect(parallelColumns[column].sensitive, column).toBe(true);
    const ytdMoney = ["taxableIncome", "insuranceDeduction", "personalDeduction", "dependentDeduction", "otherDeductions", "assessableIncome", "taxWithheld"] as const;
    for (const column of ytdMoney) expect(ytdColumns[column].sensitive, column).toBe(true);
    // The employee code and the note are not secrets and stay readable in the preview.
    expect(parallelColumns.employeeCode.sensitive).toBeUndefined();
  });
});
