// Phase 5 demo data: a pay profile and a salary structure for **every** demo person, across both
// profiles, written straight into the tables the way the payroll use-cases write them (tsx cannot
// load `server-only` services). Amounts are invented. Idempotent: a person who already has a
// profile or a structure is skipped, and so is each request.
//
//   Statutory  everyone on a labour contract — two above the insurance cap (owner, CEO), people
//              with dependents (Huy 1, Long 2, Chi 1), a part-timer, someone who starts in November
//   Simple     a probationer at 85% who joined mid-August (Linh), a collaborator on a service
//              contract (Bảo Anh), an intern whose review date has passed (Ánh)
//   Flow       Huy's raise from 1 July 2026 — approved, numbered, on his timeline; Tâm's raise from
//              1 October — waiting for the owner; Ánh's move to the Statutory profile — proposed
//   Policy     SZM has its own approved pay policy (union on, flat PIT withholding for the Simple
//              profile); the others follow the group default
import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull, or } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { createFieldCipher, parseKeyRing } from "../src/lib/crypto/field-cipher";
import { approvalAssignee, approvalEvent, approvalRequest, approvalStep, dependent, employment, entity, lifecycleEvent, payProfile, payrollPolicy, person, personSensitive, roleAssignment, salaryStructure } from "../src/lib/db/schema";
import { sensitiveContext } from "../src/modules/core-hr/field-contexts";
import { DEFAULT_PAYROLL_POLICY, type SalaryTerms } from "../src/modules/payroll/enums";
import { salaryChangeContext, salaryTermsContext } from "../src/modules/payroll/field-contexts";

type Db = ReturnType<typeof drizzle>;
type Pay = { base: number; insurance?: number; allowances?: Record<string, number>; simple?: { basis: "probation" | "internship" | "service_contract"; reviewDate?: string }; union?: boolean };

const MEAL = 730_000;
const staff = (base: number, extra: Record<string, number> = {}): Pay => ({ base, allowances: { ALW_MEAL: MEAL, ...extra } });

const PAY: Record<string, Pay> = {
  "owner@suzu.vn": staff(120_000_000, { ALW_RESPONSIBILITY: 20_000_000, ALW_PHONE: 1_000_000 }),
  "ha.nguyen@suzu.vn": staff(90_000_000, { ALW_RESPONSIBILITY: 10_000_000, ALW_PHONE: 1_000_000 }),
  "mai.le@suzu.group": staff(45_000_000, { ALW_RESPONSIBILITY: 3_000_000, ALW_PHONE: 500_000 }),
  "bao.pham@suzu.group": { ...staff(18_000_000, { ALW_TRANSPORT: 500_000 }), union: true },
  "tuan.vo@suzu.group": staff(48_000_000, { ALW_RESPONSIBILITY: 3_000_000, ALW_PHONE: 500_000 }),
  "long.dang@suzu.group": { ...staff(38_000_000, { ALW_RESPONSIBILITY: 3_000_000, ALW_PHONE: 500_000 }), union: true },
  "tam.bui@suzu.group": { ...staff(28_000_000, { ALW_TRANSPORT: 500_000 }), union: true },
  // Huy's first structure; the raise below takes over on 1 July 2026.
  "huy.ho@suzu.group": { ...staff(18_000_000, { ALW_TRANSPORT: 500_000 }), union: true },
  // 85% of the position's 16,000,000 while on probation (FR-PAY-05).
  "linh.do@suzu.group": { base: 13_600_000, allowances: { ALW_MEAL: MEAL }, simple: { basis: "probation", reviewDate: "2026-10-02" } },
  "chi.duong@suzu.group": staff(35_000_000, { ALW_RESPONSIBILITY: 2_000_000, ALW_PHONE: 500_000 }),
  "khoi.ly@suzu.group": staff(17_000_000),
  "anh.trinh@suzu.group": { base: 5_000_000, simple: { basis: "internship", reviewDate: "2026-09-15" } },
  "duc.phan@suzu.group": staff(19_000_000, { ALW_PHONE: 300_000 }),
  // Part-time: the insurance salary follows the contract, below the base after allowances.
  "duyen.huynh@suzu.group": { base: 9_000_000, insurance: 9_000_000, allowances: { ALW_MEAL: 400_000 } },
  "thu.mai@suzu.group": staff(15_000_000),
  "ngan.vu@suzu.group": staff(22_000_000),
};
// People without a mailbox, by name.
const PAY_BY_NAME: Record<string, Pay> = { "Ngô Bảo Anh": { base: 12_000_000, simple: { basis: "service_contract", reviewDate: "2026-12-31" } } };
const DEFAULT_PAY = staff(14_000_000);

const termsOf = (pay: Pay): SalaryTerms => ({ baseSalary: pay.base, insuranceSalary: pay.simple ? 0 : (pay.insurance ?? pay.base), allowances: Object.entries(pay.allowances ?? {}).map(([code, amount]) => ({ code, amount })) });

export async function seedPayroll(db: Db): Promise<string> {
  const keys = process.env.DATA_ENCRYPTION_KEYS;
  if (!keys) return "no payroll data (DATA_ENCRYPTION_KEYS is not set)";
  const cipher = createFieldCipher(parseKeyRing(keys));
  // Everyone employed at some point from August 2026 on (the first payroll month of the demo) — someone with a last day ahead is still paid.
  const people = await db.select({ person, job: employment }).from(person).innerJoin(employment, and(eq(employment.personId, person.id), or(isNull(employment.endDate), gte(employment.endDate, "2026-08-01"))));
  const byEmail = (email: string) => people.find((row) => row.person.workEmail === email);
  const owner = byEmail("owner@suzu.vn");
  const hrLead = byEmail("mai.le@suzu.group");
  if (!owner || !hrLead) return "no payroll data (run the people seed first)";

  let profiles = 0;
  let structures = 0;
  for (const { person: who, job } of people) {
    const pay = (who.workEmail ? PAY[who.workEmail] : PAY_BY_NAME[who.fullName]) ?? DEFAULT_PAY;
    const [hasProfile] = await db.select({ id: payProfile.id }).from(payProfile).where(eq(payProfile.employmentId, job.id)).limit(1);
    if (!hasProfile) {
      await db.insert(payProfile).values({
        personId: who.id,
        employmentId: job.id,
        entityId: job.entityId,
        profile: pay.simple ? "simple" : "statutory",
        simpleBasis: pay.simple?.basis ?? null,
        reviewDate: pay.simple?.reviewDate ?? null,
        insuranceExemption: pay.simple?.basis === "probation" ? "probation" : null,
        unionMember: pay.union ?? false,
        validFrom: job.startDate,
        status: "approved",
        proposedByPersonId: hrLead.person.id,
        // Being put on the Simple profile is the owner's decision (FR-PAY-07).
        decidedByPersonId: pay.simple ? owner.person.id : null,
        decidedAt: new Date(),
        note: "Dữ liệu mẫu",
      });
      profiles++;
    }
    const [hasStructure] = await db.select({ id: salaryStructure.id }).from(salaryStructure).where(eq(salaryStructure.employmentId, job.id)).limit(1);
    if (!hasStructure) {
      const id = randomUUID();
      await db.insert(salaryStructure).values({ id, personId: who.id, employmentId: job.id, entityId: job.entityId, validFrom: job.startDate, termsEnc: cipher.encrypt(JSON.stringify(termsOf(pay)), salaryTermsContext(id)), reason: "initial", createdByPersonId: hrLead.person.id, decidedByPersonId: owner.person.id });
      structures++;
    }
  }

  // Dependents for the PIT deduction (FR-PAY-13): Huy already has one from the records seed.
  let dependents = 0;
  for (const [email, family] of Object.entries({
    "long.dang@suzu.group": [
      { fullName: "Đặng Hoàng Nam", relationship: "child" as const, dateOfBirth: "2018-05-20", deductionFrom: "2020-09-01", deductionTo: null },
      // Registered from August 2026 only: July counts one dependent, August two.
      { fullName: "Đặng Thị Hồng", relationship: "parent" as const, dateOfBirth: "1958-02-11", deductionFrom: "2026-08-01", deductionTo: null },
    ],
    "chi.duong@suzu.group": [{ fullName: "Dương Gia Hân", relationship: "child" as const, dateOfBirth: "2021-11-03", deductionFrom: "2022-01-01", deductionTo: null }],
  })) {
    const found = byEmail(email);
    if (!found || (await db.select({ id: dependent.id }).from(dependent).where(eq(dependent.personId, found.person.id)).limit(1)).length) continue;
    await db.insert(dependent).values(family.map((row) => ({ ...row, personId: found.person.id })));
    dependents += family.length;
  }

  // A pay account for every Statutory-profile person who has none. A run cannot honestly be
  // marked paid while somebody it owes money to cannot be transferred to — which is exactly what
  // the payment rules refuse (FR-PAY-33) — so the demo company banks everyone, alternating
  // between the two banks the system can write files for.
  let accounts = 0;
  const statutory = await db.select({ personId: payProfile.personId }).from(payProfile).where(and(eq(payProfile.profile, "statutory"), eq(payProfile.status, "approved")));
  for (const [index, row] of statutory.entries()) {
    const holder = people.find((candidate) => candidate.person.id === row.personId);
    if (!holder) continue;
    const [existing] = await db.select().from(personSensitive).where(eq(personSensitive.personId, row.personId)).limit(1);
    if (existing?.bankAccounts) continue;
    const ascii = holder.person.searchName.toUpperCase();
    const account = [{ bankName: index % 2 === 0 ? "Vietcombank" : "ACB", accountNumber: `00710009${String(100000 + index).slice(-6)}`, accountHolder: ascii, branch: "TP.HCM" }];
    const sealed = cipher.encrypt(JSON.stringify(account), sensitiveContext("bankAccounts", row.personId));
    if (existing) await db.update(personSensitive).set({ bankAccounts: sealed }).where(eq(personSensitive.personId, row.personId));
    else await db.insert(personSensitive).values({ personId: row.personId, bankAccounts: sealed });
    accounts++;
  }

  // SZM's own pay policy: union on, flat PIT withholding for the Simple profile.
  let policies = 0;
  const [media] = await db.select().from(entity).where(eq(entity.code, "SZM")).limit(1);
  if (media && (await db.select({ id: payrollPolicy.id }).from(payrollPolicy).where(eq(payrollPolicy.entityId, media.id)).limit(1)).length === 0) {
    await db.insert(payrollPolicy).values({ entityId: media.id, value: { ...DEFAULT_PAYROLL_POLICY, unionEnabled: true, simplePitTreatment: "flat_withholding" }, validFrom: "2026-01-01", status: "approved", proposedByPersonId: hrLead.person.id, decidedByPersonId: owner.person.id, decidedAt: new Date(), note: "Dữ liệu mẫu: SZM có công đoàn; hồ sơ Đơn giản khấu trừ thuế theo tỷ lệ." });
    policies++;
  }

  // The salary change flow, as the approval engine writes it.
  const flow = { steps: [{ key: "owner", mode: "any", approvers: [{ rule: "role", role: "owner" }] }] };
  const request = async (input: { email: string; validFrom: string; reason: "raise" | "promotion"; pay: Pay; note: string; approved: boolean; createdAt: string }): Promise<number> => {
    const subject = byEmail(input.email);
    if (!subject) return 0;
    const [existing] = await db.select({ id: approvalRequest.id }).from(approvalRequest).where(and(eq(approvalRequest.type, "salary_change"), eq(approvalRequest.subjectPersonId, subject.person.id))).limit(1);
    if (existing) return 0;
    const id = randomUUID();
    const created = new Date(input.createdAt);
    const decided = new Date(created.getTime() + 2 * 86_400_000);
    const reasonLabel = input.reason === "raise" ? "Tăng lương" : "Điều chỉnh lương do thăng chức";
    await db.insert(approvalRequest).values({
      id,
      type: "salary_change",
      entityId: subject.job.entityId,
      requesterPersonId: hrLead.person.id,
      subjectPersonId: subject.person.id,
      status: input.approved ? "approved" : "pending",
      summary: `${reasonLabel} — hiệu lực ${input.validFrom.split("-").reverse().join("/")}`,
      // No amounts here: they are in the encrypted payload only.
      payload: { reason: input.reason, validFrom: input.validFrom, employmentId: subject.job.id, initial: false },
      payloadEnc: cipher.encrypt(JSON.stringify({ terms: termsOf(input.pay), note: input.note }), salaryChangeContext(id)),
      flowSnapshot: { definition: flow, resolved: [{ key: "owner", mode: "any", applies: true, approverIds: [owner.person.id] }] },
      link: `/payroll/salaries/changes/${id}`,
      createdAt: created,
      decidedAt: input.approved ? decided : null,
    });
    const [step] = await db.insert(approvalStep).values({ requestId: id, stepIndex: 0, key: "owner", mode: "any", status: input.approved ? "approved" : "pending" }).returning();
    await db.insert(approvalAssignee).values({ stepId: step.id, requestId: id, approverPersonId: owner.person.id, status: input.approved ? "approved" : "pending", decidedAt: input.approved ? decided : null });
    await db.insert(approvalEvent).values({ requestId: id, type: "submitted", actorPersonId: hrLead.person.id, stepIndex: 0, at: created });
    if (!input.approved) return 1;

    await db.insert(approvalEvent).values({ requestId: id, type: "approved", actorPersonId: owner.person.id, stepIndex: 0, at: decided });
    const [current] = await db.select().from(salaryStructure).where(and(eq(salaryStructure.employmentId, subject.job.id), isNull(salaryStructure.validTo))).limit(1);
    const dayBefore = new Date(Date.parse(`${input.validFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    if (current) await db.update(salaryStructure).set({ validTo: dayBefore }).where(eq(salaryStructure.id, current.id));
    const structureId = randomUUID();
    const [home] = await db.select({ code: entity.code }).from(entity).where(eq(entity.id, subject.job.entityId)).limit(1);
    await db.insert(salaryStructure).values({ id: structureId, personId: subject.person.id, employmentId: subject.job.id, entityId: subject.job.entityId, validFrom: input.validFrom, termsEnc: cipher.encrypt(JSON.stringify(termsOf(input.pay)), salaryTermsContext(structureId)), reason: input.reason, approvalRequestId: id, decisionNumber: `001/${input.validFrom.slice(0, 4)}/QĐL-${home?.code ?? "X"}`, decidedByPersonId: owner.person.id, createdByPersonId: hrLead.person.id, createdAt: decided });
    await db.insert(lifecycleEvent).values({ personId: subject.person.id, employmentId: subject.job.id, entityId: subject.job.entityId, type: "salary_change", effectiveDate: input.validFrom, status: "applied", reason: input.reason, details: {}, approvalRequestId: id, createdByPersonId: owner.person.id });
    return 1;
  };
  let requests = 0;
  requests += await request({ email: "huy.ho@suzu.group", validFrom: "2026-07-01", reason: "raise", pay: { ...staff(20_000_000, { ALW_TRANSPORT: 500_000 }) }, note: "Xét tăng lương định kỳ giữa năm.", approved: true, createdAt: "2026-06-22T03:00:00Z" });
  requests += await request({ email: "tam.bui@suzu.group", validFrom: "2026-10-01", reason: "raise", pay: { ...staff(31_000_000, { ALW_TRANSPORT: 500_000 }) }, note: "Đề xuất của trưởng phòng Sản xuất Video sau dự án TVC quý 3.", approved: false, createdAt: "2026-09-16T02:30:00Z" });

  // A move between profiles waiting for the owner: the intern becomes a Statutory employee.
  let proposals = 0;
  const intern = byEmail("anh.trinh@suzu.group");
  if (intern && (await db.select({ id: payProfile.id }).from(payProfile).where(and(eq(payProfile.employmentId, intern.job.id), eq(payProfile.status, "proposed"))).limit(1)).length === 0) {
    await db.insert(payProfile).values({ personId: intern.person.id, employmentId: intern.job.id, entityId: intern.job.entityId, profile: "statutory", validFrom: "2026-10-01", status: "proposed", proposedByPersonId: hrLead.person.id, note: "Ký HĐLĐ chính thức sau kỳ thực tập." });
    proposals++;
  }

  // The entity C&B persona keeps her grant even if the people seed ran before this file existed.
  const cnb = byEmail("ngan.vu@suzu.group");
  if (cnb && (await db.select({ id: roleAssignment.id }).from(roleAssignment).where(and(eq(roleAssignment.personId, cnb.person.id), eq(roleAssignment.role, "payroll"))).limit(1)).length === 0) {
    await db.insert(roleAssignment).values({ personId: cnb.person.id, role: "payroll", scopeType: "entity", scopeId: cnb.job.entityId });
  }

  return `${profiles} pay profiles, ${structures} salary structures, ${accounts} pay accounts added, ${dependents} dependents, ${policies} entity pay policy, ${requests} salary change requests, ${proposals} profile proposal`;
}
