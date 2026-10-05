// Leave rules on the owner's word (FR-PLT-39), against a real database (PGlite): HR's proposal
// changes nothing, the owner's approval writes it, a rejection leaves the rule as it was, and no
// configured flow can send the decision to anybody but the owner.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { saveFlow } from "@/modules/platform/approvals/flows";
import { listInbox } from "@/modules/platform/approvals/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { decideLeaveRuleChange, proposeLeaveRuleChange } from "./rule-changes";
import { leaveSeedRows } from "./seed-types";
import { type LeavePolicyInput, listPolicies } from "./types";

const ids = {} as Record<"entity" | "owner" | "hr" | "annual", string>;
const policy = (overrides: Partial<LeavePolicyInput> = {}): LeavePolicyInput => ({ leaveTypeId: ids.annual, entityId: null, validFrom: "2027-01-01", accrualMethod: "monthly_accrual", baseSource: "statutory_annual", fixedDaysCenti: 0, extraDaysCenti: 200, seniorityBonus: true, prorate: true, rounding: "half_day", probationRule: "accrue_no_use", carryOverCapCenti: 500, carryOverExpiry: "03-31", payoutOnTermination: true, allowNegativeCenti: 0, note: null, ...overrides });
const versions = async () => (await listPolicies([ids.annual], db())).map((row) => [row.validFrom, row.extraDaysCenti]);

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "SZM" }).returning();
  ids.entity = entity.id;
  const person = async (name: string) => (await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${name.toLowerCase()}@suzu.group`, primaryEntityId: entity.id }).returning())[0].id;
  ids.owner = await person("Owner");
  ids.hr = await person("Hr");
  await db().insert(schema.roleAssignment).values([
    { personId: ids.owner, role: "owner", scopeType: "group" },
    { personId: ids.hr, role: "hr_admin", scopeType: "group" },
  ]);
  for (const seed of leaveSeedRows()) {
    const [created] = await db().insert(schema.leaveType).values(seed.type).returning();
    if (created.code === "ANNUAL") ids.annual = created.id;
    if (seed.policy) await db().insert(schema.leavePolicy).values({ ...seed.policy, leaveTypeId: created.id });
  }
});

describe("a proposed leave policy", () => {
  it("changes nothing until the owner approves, then takes effect", async () => {
    const before = await versions();
    const { requestId } = await proposeLeaveRuleChange({ kind: "leave_policy", input: policy() }, ids.hr);
    expect(await versions()).toEqual(before);
    expect((await listInbox(ids.owner)).map((row) => row.id)).toContain(requestId);

    const { outcome } = await decideLeaveRuleChange(ids.owner, requestId, { action: "approve", comment: null });
    expect(outcome).toBe("approved");
    expect(await versions()).toContainEqual(["2027-01-01", 200]);
    const [created] = (await listPolicies([ids.annual], db())).filter((row) => row.validFrom === "2027-01-01");
    // Written as the proposer's, approved by the owner.
    expect(created.createdByPersonId).toBe(ids.hr);
  });

  it("leaves the rule as it was when the owner rejects it", async () => {
    const before = await versions();
    const { requestId } = await proposeLeaveRuleChange({ kind: "leave_policy", input: policy({ validFrom: "2027-07-01", extraDaysCenti: 900 }) }, ids.hr);
    await decideLeaveRuleChange(ids.owner, requestId, { action: "reject", comment: "Chưa đến lúc" });
    expect(await versions()).toEqual(before);
  });

  it("goes to the owner whatever flow an administrator configured", async () => {
    await saveFlow({ requestType: "leave_rule", entityId: null, definition: { steps: [{ key: "hr", mode: "any", approvers: [{ rule: "permission", permission: "leave:manage" }] }] }, active: true }, ids.hr);
    const { requestId } = await proposeLeaveRuleChange({ kind: "leave_type", input: { ...(await db().select().from(schema.leaveType).where(eq(schema.leaveType.id, ids.annual)))[0], name: "Phép năm (mới)" } }, ids.hr);
    expect((await listInbox(ids.owner)).map((row) => row.id)).toContain(requestId);
    expect((await listInbox(ids.hr)).map((row) => row.id)).not.toContain(requestId);
  });
});
