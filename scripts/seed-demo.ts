// Seeds a small fake company for local development: people, employments, assignments and role grants.
// Refuses to run against anything but a local database. Run `pnpm db:seed` first, then `pnpm db:seed:demo`.
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { blindIndex, createFieldCipher, parseKeyRing } from "../src/lib/crypto/field-cipher";
import { approvalAssignee, approvalEvent, approvalRequest, approvalStep, assignment, contract, department, dependent, emergencyContact, employeeCodeScheme, employment, entity, lifecycleEvent, person, personProfile, personSensitive, position, roleAssignment, task, taskTemplate, taskTemplateItem } from "../src/lib/db/schema";
import { planChecklist } from "../src/modules/platform/tasks-engine/engine/checklist";
import { toSearchKey } from "../src/lib/text";
import { seedAttendance, seedPunches } from "./seed-demo-attendance";
import { seedComms } from "./seed-demo-comms";
import { seedLeave } from "./seed-demo-leave";
import { seedKb } from "./seed-demo-kb";
import { seedKpis } from "./seed-demo-kpis";
import { seedPayroll } from "./seed-demo-payroll";
import { describeRecruitSeed, seedRecruit } from "./seed-demo-recruit";
import { seedPerformance } from "./seed-demo-performance";
import { seedPerformanceResults } from "./seed-demo-results";
import { seedReviews } from "./seed-demo-reviews";
import { seedAssets } from "./seed-demo-assets";
import { seedAttendanceRequests } from "./seed-demo-requests";
import { seedGenericRequests } from "./seed-demo-requests-generic";
import { seedWork, seedWorkConversations } from "./seed-demo-work";
import { seedWorkIntake } from "./seed-demo-work-intake";
import { seedWorkPlanning } from "./seed-demo-work-planning";
import { changeRequestContext, contractTermsContext, dependentContext, NATIONAL_ID_INDEX_CONTEXT, normalizeIdNumber, sensitiveContext } from "../src/modules/core-hr/field-contexts";

config({ path: ".env.local" });

type Demo = {
  name: string;
  email: string | null;
  entity: string;
  department: string;
  position: string;
  type?: "employee" | "probation" | "intern" | "part_time" | "collaborator";
  manager?: string;
  start: string;
  role?: { role: string; scope: "group" | "entity" | "department" };
};

// `manager` refers to an earlier row by email.
const PEOPLE: Demo[] = [
  { name: "Trần Đình Khánh", email: "owner@suzu.vn", entity: "SZG", department: "BOD", position: "Chủ tịch", start: "2019-03-01", role: { role: "owner", scope: "group" } },
  { name: "Nguyễn Thu Hà", email: "ha.nguyen@suzu.vn", entity: "SZG", department: "BOD", position: "Tổng Giám đốc", manager: "owner@suzu.vn", start: "2019-06-01", role: { role: "c_level", scope: "group" } },
  { name: "Lê Thị Mai", email: "mai.le@suzu.group", entity: "SZG", department: "HR", position: "Trưởng phòng Nhân sự", manager: "ha.nguyen@suzu.vn", start: "2020-02-10", role: { role: "hr_admin", scope: "group" } },
  { name: "Phạm Quốc Bảo", email: "bao.pham@suzu.group", entity: "SZM", department: "HR", position: "Chuyên viên Nhân sự", manager: "mai.le@suzu.group", start: "2022-08-01", role: { role: "hr_staff", scope: "entity" } },
  { name: "Võ Minh Tuấn", email: "tuan.vo@suzu.group", entity: "SZG", department: "FIN", position: "Kế toán trưởng", manager: "ha.nguyen@suzu.vn", start: "2020-05-04", role: { role: "finance", scope: "group" } },
  { name: "Đặng Hoàng Long", email: "long.dang@suzu.group", entity: "SZM", department: "VID", position: "Trưởng phòng Sản xuất Video", manager: "ha.nguyen@suzu.vn", start: "2020-09-14", role: { role: "department_head", scope: "department" } },
  { name: "Bùi Thanh Tâm", email: "tam.bui@suzu.group", entity: "SZM", department: "VID", position: "Đạo diễn", manager: "long.dang@suzu.group", start: "2021-03-01" },
  { name: "Hồ Gia Huy", email: "huy.ho@suzu.group", entity: "SZM", department: "VID", position: "Dựng phim", manager: "long.dang@suzu.group", start: "2023-07-17" },
  { name: "Đỗ Khánh Linh", email: "linh.do@suzu.group", entity: "SZM", department: "VID", position: "Dựng phim", type: "probation", manager: "long.dang@suzu.group", start: "2026-08-03" },
  { name: "Ngô Bảo Anh", email: null, entity: "SZM", department: "VID", position: "Quay phim", type: "collaborator", manager: "tam.bui@suzu.group", start: "2025-11-01" },
  { name: "Dương Thùy Chi", email: "chi.duong@suzu.group", entity: "SZC", department: "DES", position: "Trưởng nhóm Thiết kế", manager: "ha.nguyen@suzu.vn", start: "2021-01-11", role: { role: "department_head", scope: "department" } },
  { name: "Lý Minh Khôi", email: "khoi.ly@suzu.group", entity: "SZC", department: "DES", position: "Thiết kế đồ họa", manager: "chi.duong@suzu.group", start: "2022-04-18" },
  { name: "Trịnh Ngọc Ánh", email: "anh.trinh@suzu.group", entity: "SZC", department: "DES", position: "Thiết kế đồ họa", type: "intern", manager: "chi.duong@suzu.group", start: "2026-06-15" },
  { name: "Phan Văn Đức", email: "duc.phan@suzu.group", entity: "SZC", department: "SOC", position: "Social Media Executive", manager: "ha.nguyen@suzu.vn", start: "2023-02-06" },
  { name: "Huỳnh Mỹ Duyên", email: "duyen.huynh@suzu.group", entity: "SZC", department: "CON", position: "Content Writer", type: "part_time", manager: "duc.phan@suzu.group", start: "2024-10-01" },
  { name: "Mai Anh Thư", email: "thu.mai@suzu.group", entity: "SZC", department: "ACC", position: "Account Executive", manager: "ha.nguyen@suzu.vn", start: "2026-11-02" },
  // Phase 5: C&B for one entity only — the persona that proves payroll access stops at the entity. Last, so nobody's employee code moves.
  { name: "Vũ Thị Ngân", email: "ngan.vu@suzu.group", entity: "SZC", department: "HR", position: "Chuyên viên C&B", manager: "mai.le@suzu.group", start: "2024-03-04", role: { role: "payroll", scope: "entity" } },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Demo data is for a local database only.");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);

  const today = new Date().toISOString().slice(0, 10);
  const entities = new Map((await db.select().from(entity)).map((row) => [row.code, row]));
  const departments = new Map((await db.select().from(department)).map((row) => [row.code, row]));
  if (entities.size === 0 || departments.size === 0) throw new Error("Run `pnpm db:seed` first.");

  let created = 0;
  await db.transaction(async (tx) => {
    const idByEmail = new Map<string, string>();
    // Codes continue from each entity's numbering scheme, so a person added to the list later
    // (or hired through the app in between) never collides with a code already handed out.
    const counters = new Map<string, number>();
    for (const scheme of await tx.select().from(employeeCodeScheme)) {
      const home = [...entities.values()].find((row) => row.id === scheme.entityId);
      if (home) counters.set(home.code, scheme.nextNumber - 1);
    }
    for (const demo of PEOPLE) {
      const home = entities.get(demo.entity)!;
      const dept = departments.get(demo.department)!;
      const [existing] = await tx
        .select()
        .from(person)
        .where(demo.email ? eq(person.workEmail, demo.email) : eq(person.searchName, toSearchKey(demo.name)))
        .limit(1);
      if (existing) {
        if (demo.email) idByEmail.set(demo.email, existing.id);
        continue;
      }
      const workforceType = demo.type ?? "employee";
      const managerId = demo.manager ? (idByEmail.get(demo.manager) ?? null) : null;
      const [row] = await tx
        .insert(person)
        .values({
          fullName: demo.name,
          searchName: toSearchKey(demo.name),
          workEmail: demo.email,
          workforceType,
          status: demo.start > today ? "preboarding" : "active",
          primaryEntityId: home.id,
          departmentId: dept.id,
          managerId,
        })
        .returning();
      if (demo.email) idByEmail.set(demo.email, row.id);
      await tx.insert(personProfile).values({ personId: row.id, nationality: "Việt Nam", phone: `09${String(10000000 + created * 7919).slice(0, 8)}` });

      const number = (counters.get(home.code) ?? 0) + 1;
      counters.set(home.code, number);
      const [job] = await tx
        .insert(position)
        .values({ name: demo.position, searchName: toSearchKey(demo.position) })
        .onConflictDoUpdate({ target: position.searchName, set: { name: demo.position } })
        .returning();
      const [contract] = await tx
        .insert(employment)
        .values({ personId: row.id, entityId: home.id, employeeCode: `${home.code}-${String(number).padStart(4, "0")}`, startDate: demo.start, seniorityDate: demo.start })
        .returning();
      await tx.insert(assignment).values({ employmentId: contract.id, workforceType, departmentId: dept.id, positionId: job.id, managerId, validFrom: demo.start });
      if (demo.role) {
        const scopeId = demo.role.scope === "entity" ? home.id : demo.role.scope === "department" ? dept.id : null;
        await tx.insert(roleAssignment).values({ personId: row.id, role: demo.role.role, scopeType: demo.role.scope, scopeId });
      }
      created++;
    }
    for (const [code, used] of counters) {
      const home = entities.get(code)!;
      await tx.insert(employeeCodeScheme).values({ entityId: home.id, prefix: `${code}-`, nextNumber: used + 1 }).onConflictDoUpdate({ target: employeeCodeScheme.entityId, set: { nextNumber: used + 1 } });
    }
  });

  console.log(`Seeded ${created} demo people (existing people skipped).`);
  console.log(`Seeded ${await seedRecords(db, today)} contracts, restricted details and dependents (existing ones skipped).`);
  console.log(`Seeded ${await seedChangeRequests(db)} pending change requests (people who already have one skipped).`);
  console.log(`Seeded ${await seedLifecycle(db, today)} lifecycle events, checklists and a resignation request (existing ones skipped).`);
  console.log(`Seeded ${await seedAttendance(db)}.`);
  console.log(`Seeded ${await seedLeave(db, today)}.`);
  // After leave: nobody punches on a day of approved leave.
  console.log(`Seeded ${await seedPunches(db)}.`);
  // After the punches: approved corrections add theirs, a day worked from home loses its clock rows.
  console.log(`Seeded ${await seedAttendanceRequests(db)}.`);
  console.log(`Seeded ${await seedWork(db, today)}.`);
  console.log(`Seeded ${await seedWorkConversations(db, today)}.`);
  console.log(`Seeded ${await seedWorkPlanning(db, today)}.`);
  console.log(`Seeded ${await seedWorkIntake(db, today)}.`);
  console.log(`Seeded ${await seedPerformance(db)}.`);
  console.log(`Seeded ${await seedKpis(db)}.`);
  console.log(`Seeded ${await seedReviews(db)}.`);
  console.log(`Seeded ${await seedPerformanceResults(db)}.`);
  console.log(`Seeded ${await seedKb(db)}.`);
  console.log(`Seeded ${await seedComms(db)}.`);
  console.log(`Seeded ${await seedGenericRequests(db)} generic requests (purchase, payment, advance, letter, trip — at every approval stage).`);
  const equipment = await seedAssets(db, today);
  console.log(`Seeded ${equipment.assets} assets, ${equipment.assigned} of them handed out, and ${equipment.bookings} bookings of the shared gear (existing register left untouched).`);
  console.log(`Seeded ${describeRecruitSeed(await seedRecruit(db, today))}.`);
  console.log(`Seeded ${await seedPayroll(db)}.`);
  // The ops tracker's instances come from the real scheduler, which only runs inside the app
  // (server-only modules cannot be loaded by tsx): start `pnpm dev`, then `pnpm db:seed:demo:ops`.
  console.log("Next: `pnpm dev` in another terminal, then `pnpm db:seed:demo:ops` (obligations) and `pnpm db:recompute` (timesheets).");
  await client.end();
}

// Week 2 records: contracts (one about to expire, one probation about to end, so the daily alerts
// have something to say), restricted details and a dependent. Encrypted exactly as the app does it.
const day = (from: string, days: number) => new Date(Date.parse(`${from}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function seedRecords(db: ReturnType<typeof drizzle>, today: string): Promise<number> {
  const keys = process.env.DATA_ENCRYPTION_KEYS;
  const indexKey = process.env.DATA_BLIND_INDEX_KEY;
  if (!keys || !indexKey) {
    console.log("DATA_ENCRYPTION_KEYS / DATA_BLIND_INDEX_KEY are not set: skipping encrypted demo records.");
    return 0;
  }
  const cipher = createFieldCipher(parseKeyRing(keys));
  const find = async (email: string) => {
    const [row] = await db.select({ person, job: employment }).from(person).innerJoin(employment, eq(employment.personId, person.id)).where(eq(person.workEmail, email)).limit(1);
    return row;
  };

  const CONTRACTS = [
    { email: "long.dang@suzu.group", number: "SZM-HDLD-2020-006", type: "indefinite" as const, start: "2020-09-14", end: null, terms: "Lương gộp 45.000.000 đ/tháng" },
    { email: "tam.bui@suzu.group", number: "SZM-HDLD-2021-007", type: "indefinite" as const, start: "2021-03-01", end: null, terms: "Lương gộp 32.000.000 đ/tháng" },
    // Ends in 30 days: on the contract-expiry countdown.
    { email: "huy.ho@suzu.group", number: "SZM-HDLD-2025-008", type: "fixed_term" as const, start: day(today, -334), end: day(today, 30), terms: "Lương gộp 22.000.000 đ/tháng" },
    // Probation ends in 10 days.
    { email: "linh.do@suzu.group", number: "SZM-HDTV-2026-009", type: "probation" as const, start: day(today, -47), end: day(today, 10), terms: "85% của 18.000.000 đ/tháng", jobCategory: "professional" as const },
  ];
  let written = 0;
  for (const demo of CONTRACTS) {
    const found = await find(demo.email);
    if (!found) continue;
    const id = randomUUID();
    const rows = await db
      .insert(contract)
      .values({ id, employmentId: found.job.id, personId: found.person.id, entityId: found.job.entityId, number: demo.number, type: demo.type, jobCategory: demo.jobCategory ?? null, signDate: demo.start, startDate: demo.start, endDate: demo.end, salaryTerms: cipher.encrypt(demo.terms, contractTermsContext(id)) })
      .onConflictDoNothing()
      .returning();
    written += rows.length;
  }

  const SENSITIVE = [
    { email: "huy.ho@suzu.group", nationalId: "079098001234", taxCode: "8456712390", socialInsuranceNumber: "7916021234", bank: { bankName: "Vietcombank", accountNumber: "0071000456789", accountHolder: "HO GIA HUY", branch: "TP.HCM" } },
    { email: "tam.bui@suzu.group", nationalId: "079095004321", taxCode: "8345612987", socialInsuranceNumber: "7914025678", bank: { bankName: "ACB", accountNumber: "218834509", accountHolder: "BUI THANH TAM", branch: "Sài Gòn" } },
    { email: "linh.do@suzu.group", nationalId: "001301009876", taxCode: null, socialInsuranceNumber: null, bank: { bankName: "Vietcombank", accountNumber: "0451000987654", accountHolder: "DO KHANH LINH", branch: "Hà Nội" } },
    // Everyone paid by transfer needs somewhere for the money to go, or the run cannot settle
    // (FR-PAY-39). Two banks between them, so a month produces a VCB batch and an ACB batch.
    { email: "bao.pham@suzu.group", nationalId: "079092003456", taxCode: "8523641079", socialInsuranceNumber: "7912034567", bank: { bankName: "Vietcombank", accountNumber: "0071000778899", accountHolder: "PHAM GIA BAO", branch: "TP.HCM" } },
    { email: "long.dang@suzu.group", nationalId: "001289007654", taxCode: "8467230915", socialInsuranceNumber: "7913045678", bank: { bankName: "ACB", accountNumber: "245667881", accountHolder: "DANG VAN LONG", branch: "Hà Nội" } },
    { email: "mai.le@suzu.group", nationalId: "079090002345", taxCode: "8391746205", socialInsuranceNumber: "7911023456", bank: { bankName: "Vietcombank", accountNumber: "0071000334455", accountHolder: "LE THI MAI", branch: "TP.HCM" } },
    { email: "chi.duong@suzu.group", nationalId: "079094005678", taxCode: "8412903746", socialInsuranceNumber: "7915067890", bank: { bankName: "ACB", accountNumber: "231889076", accountHolder: "DUONG THI CHI", branch: "Sài Gòn" } },
  ];
  for (const demo of SENSITIVE) {
    const found = await find(demo.email);
    if (!found) continue;
    const personId = found.person.id;
    const seal = (field: string, value: string | null) => (value === null ? null : cipher.encrypt(value, sensitiveContext(field, personId)));
    const rows = await db
      .insert(personSensitive)
      .values({
        personId,
        nationalId: seal("nationalId", demo.nationalId),
        nationalIdIndex: blindIndex(Buffer.from(indexKey, "base64"), normalizeIdNumber(demo.nationalId), NATIONAL_ID_INDEX_CONTEXT),
        nationalIdIssuedOn: seal("nationalIdIssuedOn", "2021-08-16"),
        nationalIdIssuedAt: seal("nationalIdIssuedAt", "Cục Cảnh sát QLHC về TTXH"),
        taxCode: seal("taxCode", demo.taxCode),
        socialInsuranceNumber: seal("socialInsuranceNumber", demo.socialInsuranceNumber),
        bankAccounts: seal("bankAccounts", JSON.stringify([demo.bank])),
      })
      .onConflictDoNothing()
      .returning();
    written += rows.length;
  }

  const huy = await find("huy.ho@suzu.group");
  if (huy && (await db.select().from(dependent).where(eq(dependent.personId, huy.person.id))).length === 0) {
    const id = randomUUID();
    await db.insert(dependent).values({ id, personId: huy.person.id, fullName: "Hồ Gia Bảo", relationship: "child", dateOfBirth: "2022-04-09", idNumber: cipher.encrypt("079222003344", dependentContext("idNumber", id)), deductionFrom: "2023-07-01" });
    await db.insert(emergencyContact).values({ personId: huy.person.id, fullName: "Trần Thị Hoa", relationship: "Vợ", phone: "0903123456" });
    written += 2;
  }
  return written;
}

// Two change requests waiting for HR, written the way the approval engine writes them: one with
// personal fields, one with a new bank account (values only in the encrypted payload).
async function seedChangeRequests(db: ReturnType<typeof drizzle>): Promise<number> {
  const keys = process.env.DATA_ENCRYPTION_KEYS;
  if (!keys) return 0;
  const cipher = createFieldCipher(parseKeyRing(keys));
  const byEmail = async (email: string) => (await db.select().from(person).where(eq(person.workEmail, email)).limit(1))[0];
  const approvers = (await Promise.all(["bao.pham@suzu.group", "mai.le@suzu.group"].map(byEmail))).filter(Boolean);
  if (approvers.length === 0) return 0;

  const REQUESTS = [
    { email: "huy.ho@suzu.group", summary: "Số điện thoại, Nơi ở hiện tại", personal: { phone: { to: "0908765432" }, currentAddress: { to: "25 Nguyễn Thị Minh Khai, P. Bến Nghé, Q.1, TP.HCM" } }, sealed: null },
    { email: "tam.bui@suzu.group", summary: "Tài khoản ngân hàng nhận lương", personal: {}, sealed: { bankAccount: { bankName: "Techcombank", accountNumber: "19036789012345", accountHolder: "BUI THANH TAM", branch: "Sài Gòn" } } },
  ];
  let written = 0;
  for (const demo of REQUESTS) {
    const requester = await byEmail(demo.email);
    if (!requester) continue;
    const [existing] = await db.select({ id: approvalRequest.id }).from(approvalRequest).where(eq(approvalRequest.subjectPersonId, requester.id)).limit(1);
    if (existing) continue;
    const [profile] = await db.select().from(personProfile).where(eq(personProfile.personId, requester.id)).limit(1);
    const personal = Object.fromEntries(Object.entries(demo.personal).map(([field, change]) => [field, { from: (profile as Record<string, unknown> | undefined)?.[field] ?? null, to: change.to }]));
    const id = randomUUID();
    const flow = { steps: [{ key: "hr", mode: "any", approvers: [{ rule: "permission", permission: "person:manage" }] }] };
    const approverIds = approvers.map((row) => row.id).filter((approverId) => approverId !== requester.id);
    await db.insert(approvalRequest).values({
      id,
      type: "profile_change",
      entityId: requester.primaryEntityId,
      requesterPersonId: requester.id,
      subjectPersonId: requester.id,
      summary: demo.summary,
      payload: { personal, restricted: demo.sealed ? Object.keys(demo.sealed) : [] },
      payloadEnc: demo.sealed ? cipher.encrypt(JSON.stringify(demo.sealed), changeRequestContext(id)) : null,
      flowSnapshot: { definition: flow, resolved: [{ key: "hr", mode: "any", applies: true, approverIds }] },
      link: `/approvals/profile-change/${id}`,
    });
    const [step] = await db.insert(approvalStep).values({ requestId: id, stepIndex: 0, key: "hr", mode: "any", status: "pending" }).returning();
    await db.insert(approvalAssignee).values(approverIds.map((approverPersonId) => ({ stepId: step.id, requestId: id, approverPersonId })));
    await db.insert(approvalEvent).values({ requestId: id, type: "submitted", actorPersonId: requester.id, stepIndex: 0 });
    written++;
  }
  return written;
}

// Week 4: a timeline for everyone, two onboarding checklists under way, a former employee, a
// termination that has not taken effect yet, and a resignation waiting for the line manager.
// Written straight into the tables, the way the lifecycle use-cases write them.
async function seedLifecycle(db: ReturnType<typeof drizzle>, today: string): Promise<number> {
  const day = (offset: number) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const byEmail = async (email: string) => (await db.select().from(person).where(eq(person.workEmail, email)).limit(1))[0];
  const jobOf = async (personId: string) => (await db.select().from(employment).where(eq(employment.personId, personId)).limit(1))[0];
  const [hrAdmin, hrMedia] = await Promise.all([byEmail("mai.le@suzu.group"), byEmail("bao.pham@suzu.group")]);
  if (!hrAdmin || !hrMedia) return 0;
  let written = 0;

  // Gender and date of birth, so the headcount report has something to group by.
  const bare = await db.select({ personId: personProfile.personId, fullName: person.fullName }).from(personProfile).innerJoin(person, eq(person.id, personProfile.personId)).where(isNull(personProfile.gender));
  for (const [index, row] of bare.entries()) {
    const female = /Thị|Thu |Thùy|Mỹ|Ngọc|Khánh Linh|Anh Thư/.test(row.fullName);
    await db.update(personProfile).set({ gender: female ? "female" : "male", dateOfBirth: `${1978 + ((index * 7) % 25)}-${String(1 + ((index * 5) % 12)).padStart(2, "0")}-15` }).where(eq(personProfile.personId, row.personId));
  }

  // Every employment starts with a hire event.
  const hired = new Set((await db.select({ id: lifecycleEvent.employmentId }).from(lifecycleEvent).where(eq(lifecycleEvent.type, "hire"))).map((row) => row.id));
  for (const job of await db.select().from(employment)) {
    if (hired.has(job.id)) continue;
    await db.insert(lifecycleEvent).values({ personId: job.personId, employmentId: job.id, entityId: job.entityId, type: "hire", effectiveDate: job.startDate, createdByPersonId: hrAdmin.id });
    written++;
  }

  const checklist = async (purpose: "onboarding" | "offboarding", event: typeof lifecycleEvent.$inferSelect, subject: typeof person.$inferSelect, hrId: string, doneCount: number) => {
    const [template] = await db.select().from(taskTemplate).where(and(eq(taskTemplate.purpose, purpose), eq(taskTemplate.isActive, true))).limit(1);
    if (!template) return;
    const items = await db.select().from(taskTemplateItem).where(eq(taskTemplateItem.templateId, template.id));
    const planned = planChecklist(items, event.effectiveDate, (rule) => (rule.rule === "subject" ? subject.id : rule.rule === "line_manager" ? subject.managerId : rule.rule === "person" ? rule.personId : hrId));
    await db.insert(task).values(
      planned.map((row, index) => ({ ...row, kind: "checklist", entityId: event.entityId, contextType: "lifecycle_event", contextId: event.id, subjectPersonId: subject.id, createdByPersonId: hrId, ...(index < doneCount ? { status: "done" as const, completedAt: new Date(), completedByPersonId: row.assigneePersonId ?? hrId } : {}) })),
    );
    written += planned.length;
  };
  const hasTasks = async (eventId: string) => (await db.select({ id: task.id }).from(task).where(eq(task.contextId, eventId)).limit(1)).length > 0;

  // Onboarding under way: the pre-boarding account executive and the probationer.
  for (const [email, hrId, done] of [["thu.mai@suzu.group", hrAdmin.id, 1], ["linh.do@suzu.group", hrMedia.id, 4]] as const) {
    const subject = await byEmail(email);
    const [event] = subject ? await db.select().from(lifecycleEvent).where(and(eq(lifecycleEvent.personId, subject.id), eq(lifecycleEvent.type, "hire"))).limit(1) : [];
    if (subject && event && !(await hasTasks(event.id))) await checklist("onboarding", event, subject, hrId, done);
  }

  // A former employee: left two months ago, offboarded, no way in.
  const [szm] = await db.select().from(entity).where(eq(entity.code, "SZM")).limit(1);
  const [video] = await db.select().from(department).where(eq(department.code, "VID")).limit(1);
  const head = await byEmail("long.dang@suzu.group");
  if (szm && video && head && !(await byEmail("dang.vu@suzu.group"))) {
    const [gone] = await db.insert(person).values({ fullName: "Vũ Hải Đăng", searchName: toSearchKey("Vũ Hải Đăng"), workEmail: "dang.vu@suzu.group", status: "offboarded", primaryEntityId: szm.id, departmentId: video.id, managerId: head.id }).returning();
    await db.insert(personProfile).values({ personId: gone.id, nationality: "Việt Nam", dateOfBirth: "1994-02-11", gender: "male", phone: "0933555777" });
    const [job] = await db.insert(employment).values({ personId: gone.id, entityId: szm.id, employeeCode: "SZM-0090", startDate: "2022-05-09", seniorityDate: "2022-05-09", endDate: day(-60) }).returning();
    await db.insert(assignment).values({ employmentId: job.id, workforceType: "employee", departmentId: video.id, managerId: head.id, validFrom: "2022-05-09", validTo: day(-60) });
    await db.insert(lifecycleEvent).values([
      { personId: gone.id, employmentId: job.id, entityId: szm.id, type: "hire", effectiveDate: "2022-05-09", createdByPersonId: hrMedia.id },
      { personId: gone.id, employmentId: job.id, entityId: szm.id, type: "termination", effectiveDate: day(-60), reason: "resignation", status: "applied", createdByPersonId: hrMedia.id },
    ]);
    written += 3;
  }

  // Leaving in twenty days: still active until then, offboarding checklist already running.
  const leaving = await byEmail("duyen.huynh@suzu.group");
  const leavingJob = leaving ? await jobOf(leaving.id) : undefined;
  if (leaving && leavingJob && leavingJob.endDate === null) {
    const lastDay = day(20);
    await db.update(employment).set({ endDate: lastDay }).where(eq(employment.id, leavingJob.id));
    const open = await db.update(assignment).set({ validTo: lastDay }).where(eq(assignment.employmentId, leavingJob.id)).returning({ id: assignment.id });
    const [event] = await db
      .insert(lifecycleEvent)
      .values({ personId: leaving.id, employmentId: leavingJob.id, entityId: leavingJob.entityId, type: "termination", effectiveDate: lastDay, status: "pending", reason: "contract_end", details: { closed: { assignments: open.map((row) => ({ id: row.id, validTo: null })), grants: [], contracts: [] }, droppedAssignments: 0 }, createdByPersonId: hrAdmin.id })
      .returning();
    await checklist("offboarding", event, leaving, hrAdmin.id, 0);
    written++;
  }

  // A resignation waiting for the line manager (long.dang).
  const resigning = await byEmail("tam.bui@suzu.group");
  if (resigning?.managerId && (await db.select({ id: approvalRequest.id }).from(approvalRequest).where(and(eq(approvalRequest.subjectPersonId, resigning.id), eq(approvalRequest.type, "resignation"))).limit(1)).length === 0) {
    const id = randomUUID();
    const lastWorkingDay = day(45);
    const flow = { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] };
    await db.insert(approvalRequest).values({
      id,
      type: "resignation",
      entityId: resigning.primaryEntityId,
      requesterPersonId: resigning.id,
      subjectPersonId: resigning.id,
      summary: `Ngày làm việc cuối: ${lastWorkingDay.split("-").reverse().join("/")}`,
      payload: { lastWorkingDay, reason: "Chuyển về quê sinh sống" },
      flowSnapshot: { definition: flow, resolved: [{ key: "manager", mode: "any", applies: true, approverIds: [resigning.managerId] }] },
      link: `/approvals/resignation/${id}`,
    });
    const [step] = await db.insert(approvalStep).values({ requestId: id, stepIndex: 0, key: "manager", mode: "any", status: "pending" }).returning();
    await db.insert(approvalAssignee).values({ stepId: step.id, requestId: id, approverPersonId: resigning.managerId });
    await db.insert(approvalEvent).values({ requestId: id, type: "submitted", actorPersonId: resigning.id, stepIndex: 0 });
    written++;
  }
  return written;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
