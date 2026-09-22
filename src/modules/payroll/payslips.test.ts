// Payslips against a real database (PGlite): release only after the CEO has signed, who may read
// one, the query thread, and — the point of the whole file — that **no query returns a payslip to
// a line manager, a department head, an entity director, HR staff, finance or the CEO**.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 3).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 5).toString("base64") }),
}));
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
// Notifications reach for the person's preferences and mailbox; the test only cares that payroll
// asks for the right people and says nothing about money.
const notified: { recipients: readonly string[]; kind: string; params?: Record<string, unknown> }[] = [];
vi.mock("@/modules/platform/notifications/service", () => ({
  notify: async (input: { recipients: readonly string[]; kind: string; params?: Record<string, unknown> }) => {
    notified.push(input);
  },
}));

import { eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { stepRun } from "./lifecycle";
import { closePayslipQuery, getPayslipView, listMyPayslips, listPayslipsOfRun, listQueriesForManager, publishPayslips, raisePayslipQuery, recordPayslipView, replyToPayslipQuery } from "./payslips";
import { calculateRun, createRegularRun } from "./runs";
import { payComponentSeedRows } from "./seed-components";

const ids = {} as Record<"entity" | "other" | "actor" | "huy" | "lan" | "manager", string>;
let runId = "";
let huyPayslipId = "";

const summary = () => ({
  days: 31,
  standardDays: 22,
  standardMinutes: 10_560,
  workedMinutes: 10_560,
  creditedMinutes: 0,
  leavePaidMinutes: 0,
  leaveUnpaidMinutes: 0,
  holidayMinutes: 0,
  absenceMinutes: 0,
  lateMinutes: 0,
  earlyMinutes: 0,
  lateCount: 0,
  earlyCount: 0,
  missingPunchDays: 0,
  absentDays: 0,
  wfhMinutes: 0,
  tripMinutes: 0,
  nightMinutes: 0,
  otWeekday: { day: 0, night: 0 },
  otRestDay: { day: 0, night: 0 },
  otHoliday: { day: 0, night: 0 },
  otTotalMinutes: 0,
  otUnapprovedMinutes: 0,
  otTimeOffMinutes: 0,
  paidDaysCenti: 2200,
  unpaidDaysCenti: 0,
  anomalyDays: 0,
});

/** A principal holding one role over one entity. */
const grantee = (personId: string, role: "hr_admin" | "hr_staff" | "c_level" | "finance" | "department_head" | "entity_director" | "auditor" | "payroll", entityId: string): Principal => ({ personId, workforceType: "employee", grants: [{ role, scope: { type: "entity", id: entityId } }] });
/** The person themselves, with no role at all. */
const self = (personId: string): Principal => ({ personId, workforceType: "employee", grants: [] });
const owner = (personId: string): Principal => ({ personId, workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] });

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [other] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.other = other.id;
  ids.actor = actor.id;

  const hire = async (name: string, startDate: string, managerId: string | null = null) => {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId: entity.id, employeeCode: null, startDate, seniorityDate: null, placement: { workforceType: "employee", branchId: null, orgUnitId: department.id, positionName: null, jobLevel: null, managerId, dottedManagerId: null, workLocation: null } },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  ids.manager = await hire("Dang Van Long", "2023-01-01");
  ids.huy = await hire("Ho Gia Huy", "2024-03-01", ids.manager);
  ids.lan = await hire("Tran Thi Lan", "2025-06-01", ids.manager);

  await db()
    .insert(schema.statutoryParameter)
    .values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });

  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  await db()
    .insert(schema.payProfile)
    .values([
      { personId: ids.huy, employmentId: employmentOf(ids.huy), entityId: entity.id, profile: "statutory", validFrom: "2024-03-01", status: "approved" },
      { personId: ids.lan, employmentId: employmentOf(ids.lan), entityId: entity.id, profile: "simple", simpleBasis: "service_contract", validFrom: "2025-06-01", status: "approved" },
    ]);

  for (const [personId, amount] of [
    [ids.huy, 30_000_000],
    [ids.lan, 15_000_000],
  ] as const) {
    const id = crypto.randomUUID();
    const terms = { baseSalary: amount, insuranceSalary: amount, allowances: [] };
    await db().insert(schema.salaryStructure).values({ id, personId, employmentId: employmentOf(personId), entityId: entity.id, validFrom: "2026-01-01", reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify(terms), salaryTermsContext(id)) });
  }

  const lockedAt = new Date("2026-08-28T03:00:00Z");
  await db().insert(schema.timesheetPeriod).values({ entityId: entity.id, month: "2026-08", status: "locked", lockedAt, lockedByPersonId: actor.id });
  await db()
    .insert(schema.timesheetMonth)
    .values([ids.huy, ids.lan].map((personId) => ({ personId, entityId: entity.id, month: "2026-08", status: "locked" as const, summary: summary(), lockedAt, lockedByPersonId: actor.id })));

  const run = await createRegularRun({ entityId: entity.id, month: "2026-08" }, actor.id);
  await calculateRun(run.id);
  runId = run.id;
});

describe("releasing a run (FR-PAY-32)", () => {
  it("refuses to publish before the CEO has signed", async () => {
    await expect(publishPayslips(runId, ids.actor)).rejects.toThrow("run_not_approved");
    // Not even once it is proposed: "published to ESS after approval" means after approval.
    await stepRun(runId, "propose", { personId: ids.actor });
    await expect(publishPayslips(runId, ids.actor)).rejects.toThrow("run_not_approved");
    expect(await listMyPayslips(ids.huy)).toEqual([]);
  });

  it("publishes to everyone in the run, dates the run, and tells each person without a figure", async () => {
    await stepRun(runId, "approve", { personId: ids.actor });
    notified.length = 0;
    const outcome = await publishPayslips(runId, ids.actor);
    expect(outcome.published).toBe(2);

    const [run] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.id, runId));
    expect(run.payslipsPublishedAt).toBeInstanceOf(Date);
    expect(run.payslipsPublishedByPersonId).toBe(ids.actor);

    expect(notified).toHaveLength(1);
    expect(notified[0].kind).toBe("payroll.payslip_published");
    expect(new Set(notified[0].recipients)).toEqual(new Set([ids.huy, ids.lan]));
    // The month and nothing else: a notification is read on a lock screen.
    expect(JSON.stringify(notified[0].params)).toBe(JSON.stringify({ month: "2026-08" }));
  });

  it("publishing again tells nobody twice", async () => {
    notified.length = 0;
    expect((await publishPayslips(runId, ids.actor)).published).toBe(0);
    expect(notified).toHaveLength(0);
  });

  it("gives the person their own months, with the net from the run itself", async () => {
    const mine = await listMyPayslips(ids.huy);
    expect(mine).toHaveLength(1);
    expect(mine[0].month).toBe("2026-08");
    expect(mine[0].net).toBeGreaterThan(0);
    huyPayslipId = mine[0].id;

    const [stored] = await db().select().from(schema.payrollRunPerson).where(eq(schema.payrollRunPerson.personId, ids.huy));
    const result = JSON.parse(fieldCipher().decrypt(stored.resultEnc, `payroll_run_person.result:${stored.id}`)) as { totals: { net: number } };
    expect(mine[0].net).toBe(result.totals.net);
  });
});

describe("who may read a payslip (SRS §2.2, FR-ACL-04)", () => {
  it("lets the person themselves read their own", async () => {
    const view = await getPayslipView(self(ids.huy), huyPayslipId);
    expect(view?.person.fullName).toBe("Ho Gia Huy");
    expect(view?.isOwner).toBe(true);
    expect(view?.result.totals.net).toBeGreaterThan(0);
  });

  it("lets C&B of that entity and the owner read it", async () => {
    expect((await getPayslipView(grantee(ids.actor, "payroll", ids.entity), huyPayslipId))?.manages).toBe(true);
    expect((await getPayslipView(grantee(ids.actor, "hr_admin", ids.entity), huyPayslipId))?.manages).toBe(true);
    expect((await getPayslipView(owner(ids.actor), huyPayslipId))?.manages).toBe(true);
  });

  it("refuses everyone else — line manager, department head, entity director, HR staff, finance, the CEO, an auditor and a colleague", async () => {
    const refused: [string, Principal][] = [
      // The line manager reads their report's personal data, never their pay (FR-ACL, SRS §2.2).
      ["line manager", self(ids.manager)],
      ["department head", grantee(ids.manager, "department_head", ids.entity)],
      ["entity director", grantee(ids.manager, "entity_director", ids.entity)],
      ["hr staff", grantee(ids.manager, "hr_staff", ids.entity)],
      // Finance and the CEO carry the run forward on totals and the variance list, never a payslip.
      ["finance", grantee(ids.manager, "finance", ids.entity)],
      ["c_level", grantee(ids.manager, "c_level", ids.entity)],
      ["auditor", grantee(ids.manager, "auditor", ids.entity)],
      ["a colleague", self(ids.lan)],
      // C&B of a different entity: the permission is held over an entity, not over payroll at large.
      ["another entity's C&B", grantee(ids.manager, "payroll", ids.other)],
    ];
    for (const [who, principal] of refused) {
      expect(await getPayslipView(principal, huyPayslipId), `${who} must not read a payslip`).toBeNull();
    }
  });

  it("answers a payslip that does not exist exactly as one that is not theirs (no IDOR oracle)", async () => {
    expect(await getPayslipView(self(ids.lan), huyPayslipId)).toBeNull();
    expect(await getPayslipView(self(ids.lan), crypto.randomUUID())).toBeNull();
  });

  it("lists only the reader's own payslips", async () => {
    // Lan's list holds Lan's month and nothing of Huy's, whoever asks.
    const lan = await listMyPayslips(ids.lan);
    expect(lan.map((row) => row.id)).not.toContain(huyPayslipId);
    expect(await listMyPayslips(ids.manager)).toEqual([]);
  });

  it("counts a reading by the owner", async () => {
    await recordPayslipView(huyPayslipId, ids.huy);
    const [row] = await db().select().from(schema.payslip).where(eq(schema.payslip.id, huyPayslipId));
    expect(row.viewCount).toBe(1);
    expect(row.firstViewedAt).toBeInstanceOf(Date);

    // Somebody else's reading is not recorded against them, even if they may see the payslip.
    await recordPayslipView(huyPayslipId, ids.manager);
    const [again] = await db().select().from(schema.payslip).where(eq(schema.payslip.id, huyPayslipId));
    expect(again.viewCount).toBe(1);
  });

  it("shows C&B who has been released a payslip and who has read it", async () => {
    const rows = await listPayslipsOfRun(runId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.payslipId)).toBe(true);
    expect(rows.find((row) => row.personId === ids.huy)?.firstViewedAt).toBeInstanceOf(Date);
  });
});

describe("payslip queries (FR-PAY-32)", () => {
  it("goes to C&B, comes back answered, and closes", async () => {
    notified.length = 0;
    const query = await raisePayslipQuery({ payslipId: huyPayslipId, body: "Vì sao thực nhận tháng này thấp hơn?" }, ids.huy);
    expect(query.status).toBe("open");
    expect(notified.at(-1)?.kind).toBe("payroll.payslip_query_raised");
    // Only the month reaches the mailbox, never the question or a figure.
    expect(JSON.stringify(notified.at(-1)?.params)).toBe(JSON.stringify({ month: "2026-08" }));

    notified.length = 0;
    const { query: answered } = await replyToPayslipQuery({ queryId: query.id, body: "Tháng này có một ngày nghỉ không lương.", fromManager: true }, ids.actor);
    expect(answered.status).toBe("answered");
    expect(answered.answeredAt).toBeInstanceOf(Date);
    expect(notified.at(-1)?.kind).toBe("payroll.payslip_query_answered");
    expect(notified.at(-1)?.recipients).toEqual([ids.huy]);

    // The employee comes back; the thread is waiting for C&B again.
    const { query: reopened } = await replyToPayslipQuery({ queryId: query.id, body: "Cảm ơn, cho mình xin ngày cụ thể.", fromManager: false }, ids.huy);
    expect(reopened.status).toBe("open");

    expect((await closePayslipQuery(query.id)).status).toBe("closed");
    await expect(replyToPayslipQuery({ queryId: query.id, body: "thêm", fromManager: false }, ids.huy)).rejects.toThrow("query_closed");
  });

  it("keeps the whole thread with the payslip, in order", async () => {
    const view = await getPayslipView(self(ids.huy), huyPayslipId);
    expect(view?.queries).toHaveLength(1);
    expect(view?.queries[0].messages.map((message) => message.authorName)).toEqual(["Ho Gia Huy", "Seed Actor", "Ho Gia Huy"]);
  });

  it("is append-only: a message cannot be rewritten or deleted", async () => {
    const [message] = await db().select().from(schema.payslipQueryMessage).limit(1);
    const failed = async (work: Promise<unknown>) => {
      const error = await work.then(() => null).catch((thrown: unknown) => thrown);
      expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(/append-only/);
    };
    await failed(db().update(schema.payslipQueryMessage).set({ body: "changed" }).where(eq(schema.payslipQueryMessage.id, message.id)));
    await failed(db().delete(schema.payslipQueryMessage).where(eq(schema.payslipQueryMessage.id, message.id)));
  });

  it("shows a manager only the queries of the entities they manage", async () => {
    expect((await listQueriesForManager(grantee(ids.actor, "payroll", ids.entity), true)).length).toBe(1);
    // C&B of the other entity sees none of it — the filter is in the SQL, not in the page.
    expect(await listQueriesForManager(grantee(ids.actor, "payroll", ids.other), true)).toEqual([]);
    // Somebody with no payroll permission at all reaches nothing.
    expect(await listQueriesForManager(self(ids.manager), true)).toEqual([]);
    expect(await listQueriesForManager(grantee(ids.manager, "department_head", ids.entity), true)).toEqual([]);
  });
});
