// The attendance policy on the owner's word (FR-PLT-39), against a real database (PGlite): HR's
// proposed version changes nothing until the owner approves it, and then it is the policy.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));

import { db, schema } from "@/lib/db";
import { listInbox } from "@/modules/platform/approvals/service";
import { migrateTestDb } from "../../../tests/helpers/db";
import { loadPolicies, type PolicyInput } from "./attendance-policies";
import { decideAttendanceRuleChange, proposeAttendancePolicy } from "./rule-changes";

const ids = {} as Record<"owner" | "hr", string>;
const input = (overrides: Partial<PolicyInput> = {}): PolicyInput => ({ entityId: null, validFrom: "2027-01-01", mergeRule: "first_in_last_out", graceLateMinutes: 10, graceEarlyMinutes: 5, roundingMinutes: 0, otMinMinutes: 30, otRequiresApproval: true, duplicateWindowMinutes: 3, breakStart: "12:00", dayBoundary: "04:00", monthlyCorrectionCap: 3, ...overrides });
const graces = async () => (await loadPolicies(db())).map((row) => [row.validFrom, row.graceLateMinutes]);

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "SZM" }).returning();
  const person = async (name: string) => (await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${name.toLowerCase()}@suzu.group`, primaryEntityId: entity.id }).returning())[0].id;
  ids.owner = await person("Owner");
  ids.hr = await person("Hr");
  await db().insert(schema.roleAssignment).values([
    { personId: ids.owner, role: "owner", scopeType: "group" },
    { personId: ids.hr, role: "hr_admin", scopeType: "group" },
  ]);
  await db().insert(schema.attendancePolicy).values({ entityId: null, validFrom: "2026-01-01", graceLateMinutes: 0 });
});

describe("a proposed attendance policy", () => {
  it("changes nothing until the owner approves, then is the policy from its date", async () => {
    const { requestId } = await proposeAttendancePolicy(input(), ids.hr);
    expect(await graces()).toEqual([["2026-01-01", 0]]);
    expect((await listInbox(ids.owner)).map((row) => row.id)).toContain(requestId);

    const { outcome, saved } = await decideAttendanceRuleChange(ids.owner, requestId, { action: "approve", comment: null });
    expect(outcome).toBe("approved");
    expect(saved?.affectedFrom).toBe("2027-01-01");
    expect((await graces()).sort()).toEqual([
      ["2026-01-01", 0],
      ["2027-01-01", 10],
    ]);
  });

  it("is not written when the owner rejects it", async () => {
    const { requestId } = await proposeAttendancePolicy(input({ validFrom: "2027-06-01", graceLateMinutes: 30 }), ids.hr);
    const { saved } = await decideAttendanceRuleChange(ids.owner, requestId, { action: "reject", comment: "Không" });
    expect(saved).toBeNull();
    expect((await graces()).some(([from]) => from === "2027-06-01")).toBe(false);
  });
});
