// Seeds editable starter data: placeholder legal entities, the shared departments (SRS D8) and the
// statutory parameter snapshot (SRS Appendix A), the starter onboarding/offboarding checklists,
// the public holidays of this year and the next, and the default work schedule.
// Safe to re-run: existing codes are left untouched. Run with `pnpm db:seed`.
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, between, inArray, isNull } from "drizzle-orm";
import { approvalFlow, assetCategory, attendancePolicy, payComponent, payrollPolicy, companyValue, documentTemplate, kbTemplate, kpiDefinition, calendarDay, orgUnit, deviceMappingProfile, entity, leavePolicy, leaveType, obligationTemplate, recruitEmailTemplate, recruitPipeline, recruitPipelineStage, requestType, statutoryParameter, taskTemplate, taskTemplateItem, workSchedule } from "../src/lib/db/schema";
import { PROFILE_SEED } from "../src/modules/attendance/engine/device-log";
import { CALENDAR_SEED, DEFAULT_POLICY_SEED, DEFAULT_SCHEDULE_SEED } from "../src/modules/attendance/seed-calendar";
import { leaveSeedRows } from "../src/modules/leave/seed-types";
import { TEMPLATE_SEED } from "../src/modules/platform/tasks-engine/seed-templates";
import { obligationSeedRows } from "../src/modules/ops/seed-library";
import { STARTER_COMPANY_VALUES } from "../src/modules/comms/seed-values";
import { kbTemplateSeedRows } from "../src/modules/kb/seed-templates";
import { kpiSeedRows } from "../src/modules/performance/seed-kpis";
import { WORK_TEMPLATE_SEED } from "../src/modules/work/seed-templates";
import { STATUTORY_SEED } from "../src/modules/platform/statutory/seed-values";
import { DEFAULT_PAYROLL_POLICY } from "../src/modules/payroll/enums";
import { PAY_COMPONENT_SEED_VALID_FROM, payComponentSeedRows } from "../src/modules/payroll/seed-components";
import { REQUEST_TYPE_SEED } from "../src/modules/requests/seed-types";
import { CATEGORY_SEED } from "../src/modules/assets/seed-categories";
import { PIPELINE_SEED, pipelineSeedProblems } from "../src/modules/recruit/seed-pipelines";
import { EMAIL_TEMPLATE_SEED } from "../src/modules/recruit/seed-email-templates";
import { emailTemplateProblems } from "../src/modules/recruit/engine/email-template";
import { DOCUMENT_TEMPLATE_SEED } from "../src/modules/documents/seed-templates";
import { templateProblems } from "../src/modules/documents/engine/template";

config({ path: ".env.local" });

const ENTITIES = [
  { code: "SZG", shortName: "SuZu Group", legalName: "Công ty Cổ phần SuZu Group (placeholder — edit me)", wageRegion: 1 },
  { code: "SZM", shortName: "SuZu Media", legalName: "Công ty TNHH SuZu Media (placeholder — edit me)", wageRegion: 1 },
  { code: "SZC", shortName: "SuZu Creative", legalName: "Công ty TNHH SuZu Creative (placeholder — edit me)", wageRegion: 1 },
];

// Shared across every entity (entityId = null).
const DEPARTMENTS = [
  { code: "BOD", name: "Ban Giám đốc" },
  { code: "HR", name: "Hành chính – Nhân sự" },
  { code: "FIN", name: "Tài chính – Kế toán" },
  { code: "ACC", name: "Account / Dịch vụ khách hàng" },
  { code: "SOC", name: "Social Media" },
  { code: "CON", name: "Content" },
  { code: "DES", name: "Thiết kế" },
  { code: "VID", name: "Sản xuất Video" },
  { code: "ADS", name: "Media Buying / Performance" },
  { code: "BD", name: "Phát triển kinh doanh" },
  { code: "IT", name: "IT" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);

  const entities = await db.insert(entity).values(ENTITIES).onConflictDoNothing({ target: entity.code }).returning();
  const departments = await db.insert(orgUnit).values(DEPARTMENTS).onConflictDoNothing({ target: orgUnit.code }).returning();
  console.log(`Seeded ${entities.length} entities and ${departments.length} shared departments (existing codes skipped).`);

  // Statutory parameters: only keys that have no version at all, so nothing HR entered is touched.
  const present = new Set((await db.selectDistinct({ key: statutoryParameter.key }).from(statutoryParameter)).map((row) => row.key));
  const missing = STATUTORY_SEED.filter((seed) => !present.has(seed.key));
  if (missing.length) await db.insert(statutoryParameter).values(missing.map((seed) => ({ ...seed, status: "approved" as const, isVerified: false })));
  console.log(`Seeded ${missing.length} statutory parameters (unverified until the chief accountant confirms them).`);

  // Pay component catalogue (FR-PAY-02): only codes that have no version at all, so nothing C&B
  // proposed or the owner approved is touched. The group's default pay policy: only when there is none.
  const componentCodes = new Set((await db.selectDistinct({ code: payComponent.code }).from(payComponent)).map((row) => row.code));
  const newComponents = payComponentSeedRows().filter((row) => !componentCodes.has(row.code));
  if (newComponents.length) await db.insert(payComponent).values(newComponents);
  const [anyPayPolicy] = await db.select({ id: payrollPolicy.id }).from(payrollPolicy).limit(1);
  if (!anyPayPolicy) await db.insert(payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: PAY_COMPONENT_SEED_VALID_FROM, status: "approved", note: "Mặc định khởi tạo — Chủ sở hữu rà soát trước kỳ lương đầu tiên." });
  console.log(`Seeded ${newComponents.length} pay components${anyPayPolicy ? "" : " and the group's default pay policy"} (starting points for the chief accountant and the owner to confirm).`);

  // Starter checklists: only for a purpose that has no template at all, so nothing HR wrote is touched.
  const purposes = new Set((await db.selectDistinct({ purpose: taskTemplate.purpose }).from(taskTemplate)).map((row) => row.purpose));
  let templates = 0;
  for (const seed of TEMPLATE_SEED.filter((template) => !purposes.has(template.purpose))) {
    const [created] = await db.insert(taskTemplate).values({ purpose: seed.purpose, name: seed.name }).returning();
    await db.insert(taskTemplateItem).values(seed.items.map((item, index) => ({ templateId: created.id, title: item.title, description: item.description ?? null, assigneeRule: item.assigneeRule, dueOffsetDays: item.dueOffsetDays, sortOrder: index })));
    templates++;
  }
  console.log(`Seeded ${templates} checklist templates (purposes that already have one skipped).`);

  // Starter work templates (FR-WRK-10), shared by every team: only names that do not exist yet.
  const workNames = new Set((await db.select({ name: taskTemplate.name }).from(taskTemplate).where(and(inArray(taskTemplate.purpose, ["work_project", "work_task"]), isNull(taskTemplate.ownerId)))).map((row) => row.name));
  let workTemplates = 0;
  for (const seed of WORK_TEMPLATE_SEED.filter((template) => !workNames.has(template.name))) {
    const [created] = await db.insert(taskTemplate).values({ purpose: seed.purpose, name: seed.name, description: seed.description }).returning();
    for (const [index, step] of seed.steps.entries()) {
      const item = (row: Omit<typeof step, "steps">, sortOrder: number, parentItemId: string | null) => ({ templateId: created.id, title: row.title, description: row.description ?? null, assigneeRule: row.role ? `role:${row.role}` : "none", roleKey: row.role ?? null, dueOffsetDays: row.day, estimateMinutes: row.hours ? row.hours * 60 : null, sortOrder, parentItemId });
      const [parent] = await db.insert(taskTemplateItem).values(item(step, index, null)).returning();
      if (step.steps?.length) await db.insert(taskTemplateItem).values(step.steps.map((child, childIndex) => item(child, childIndex, parent.id)));
    }
    workTemplates++;
  }
  console.log(`Seeded ${workTemplates} work templates (names that already exist skipped).`);

  // The obligation library (FR-OPS-03): a draft, every row unreviewed. Codes that exist are left
  // alone, so nothing the chief accountant corrected or reviewed is ever overwritten.
  const obligations = await db.insert(obligationTemplate).values(obligationSeedRows()).onConflictDoNothing({ target: obligationTemplate.code }).returning({ id: obligationTemplate.id });
  console.log(`Seeded ${obligations.length} obligation templates as unreviewed drafts (existing codes skipped).`);

  // Leave types and their starter policies: only when there is no leave type at all.
  const [anyLeaveType] = await db.select({ id: leaveType.id }).from(leaveType).limit(1);
  let leaveTypes = 0;
  if (!anyLeaveType) {
    for (const seed of leaveSeedRows()) {
      const [created] = await db.insert(leaveType).values(seed.type).returning();
      if (seed.policy) await db.insert(leavePolicy).values({ ...seed.policy, leaveTypeId: created.id });
      leaveTypes++;
    }
  }
  console.log(`Seeded ${leaveTypes} leave types with starter policies (skipped when any leave type exists).`);

  // Working calendar: only years that have no row at all, so nothing HR entered or removed comes back.
  let calendarDays = 0;
  for (const year of [...new Set(CALENDAR_SEED.map((row) => row.date.slice(0, 4)))]) {
    const [existing] = await db.select({ id: calendarDay.id }).from(calendarDay).where(between(calendarDay.date, `${year}-01-01`, `${year}-12-31`)).limit(1);
    if (existing) continue;
    const rows = CALENDAR_SEED.filter((row) => row.date.startsWith(year));
    await db.insert(calendarDay).values(rows.map((row) => ({ ...row, entityId: null, isConfirmed: false })));
    calendarDays += rows.length;
  }
  console.log(`Seeded ${calendarDays} public holidays (unconfirmed until HR checks them against the official announcement).`);

  // The default schedule: only when there is no schedule at all.
  const [anySchedule] = await db.select({ id: workSchedule.id }).from(workSchedule).limit(1);
  if (!anySchedule) await db.insert(workSchedule).values({ ...DEFAULT_SCHEDULE_SEED, entityId: null, isDefault: true });
  console.log(`Seeded ${anySchedule ? 0 : 1} default work schedule.`);

  // The group's attendance policy (company practice, HR edits it) and two starter mapping profiles
  // for device logs: each only when there is none at all.
  const [anyPolicy] = await db.select({ id: attendancePolicy.id }).from(attendancePolicy).limit(1);
  if (!anyPolicy) await db.insert(attendancePolicy).values(DEFAULT_POLICY_SEED);
  const [anyProfile] = await db.select({ id: deviceMappingProfile.id }).from(deviceMappingProfile).limit(1);
  if (!anyProfile) await db.insert(deviceMappingProfile).values(PROFILE_SEED.map((profile) => ({ ...profile, entityId: null })));
  console.log(`Seeded ${anyPolicy ? 0 : 1} attendance policy and ${anyProfile ? 0 : PROFILE_SEED.length} device mapping profiles.`);

  // The starter KPI library (FR-PRF-02): only codes that do not exist — an edited or switched-off KPI stays as HR left it.
  const kpiCodes = new Set((await db.select({ code: kpiDefinition.code }).from(kpiDefinition)).map((row) => row.code));
  const newKpis = kpiSeedRows().filter((row) => !kpiCodes.has(row.code));
  if (newKpis.length) await db.insert(kpiDefinition).values(newKpis);
  console.log(`Seeded ${newKpis.length} KPI definitions (existing codes left untouched).`);

  // Knowledge-base page templates (FR-KB-09): only keys that do not exist yet.
  const templateKeys = new Set((await db.select({ key: kbTemplate.key }).from(kbTemplate)).map((row) => row.key));
  const newTemplates = kbTemplateSeedRows().filter((row) => !templateKeys.has(row.key));
  if (newTemplates.length) await db.insert(kbTemplate).values(newTemplates);
  console.log(`Seeded ${newTemplates.length} knowledge-base page templates (existing keys left untouched).`);

  // The request types the company files (FR-REQ-02) and the flow each one runs: only codes that do
  // not exist yet, so a form an administrator has edited is never overwritten. The flow is a plain
  // group-wide `approval_flow` row — the builder does not keep a second flow store.
  const typeCodes = new Set((await db.select({ code: requestType.code }).from(requestType)).map((row) => row.code));
  const newTypes = REQUEST_TYPE_SEED.filter((seed) => !typeCodes.has(seed.code));
  for (const seed of newTypes) {
    const { flow, ...row } = seed;
    await db.insert(requestType).values(row);
    await db
      .insert(approvalFlow)
      .values({ requestType: `request:${seed.code}`, entityId: null, definition: flow, active: true })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${newTypes.length} request types with their approval flows (existing codes left untouched).`);

  // The asset categories (FR-AST-01), shared by the group: only codes that do not exist yet, so a
  // category whose warranty or serial rule has been edited is never overwritten.
  const categoryCodes = new Set((await db.select({ code: assetCategory.code }).from(assetCategory)).map((row) => row.code));
  const newCategories = CATEGORY_SEED.filter((seed) => !categoryCodes.has(seed.code));
  if (newCategories.length) await db.insert(assetCategory).values(newCategories.map((row) => ({ ...row })));
  console.log(`Seeded ${newCategories.length} asset categories (existing codes left untouched).`);

  // Document templates (FR-CHR-06). The tier on each is enforced by the engine, not by this file:
  // a body naming a salary cannot be stored below the compensation tier, which is why the salary
  // confirmation letter and the labour contract are seeded `compensation`.
  const templateCodes = new Set((await db.select({ code: documentTemplate.code }).from(documentTemplate)).map((row) => row.code));
  const newDocTemplates = DOCUMENT_TEMPLATE_SEED.filter((seed) => !templateCodes.has(seed.code));
  const leaky = newDocTemplates.filter((seed) => templateProblems({ name: seed.name, body: seed.body, tier: seed.tier }).length > 0);
  if (leaky.length) throw new Error(`document template seed is invalid: ${leaky.map((seed) => `${seed.code} (${templateProblems({ name: seed.name, body: seed.body, tier: seed.tier }).join(", ")})`).join("; ")}`);
  if (newDocTemplates.length) await db.insert(documentTemplate).values(newDocTemplates.map((row) => ({ ...row })));
  console.log(`Seeded ${newDocTemplates.length} document templates (existing codes left untouched).`);

  // Hiring pipelines (FR-REC-02): only codes that do not exist yet, so a pipeline whose stages a
  // recruiter has renamed or reordered is never overwritten. The seed is validated first — a
  // pipeline with nowhere for an application to start would break every opening using it.
  const pipelineCodes = new Set((await db.select({ code: recruitPipeline.code }).from(recruitPipeline)).map((row) => row.code));
  const newPipelines = PIPELINE_SEED.filter((seed) => !pipelineCodes.has(seed.code));
  const brokenPipelines = newPipelines.filter((seed) => pipelineSeedProblems(seed).length > 0);
  if (brokenPipelines.length) throw new Error(`pipeline seed is invalid: ${brokenPipelines.map((seed) => `${seed.code} (${pipelineSeedProblems(seed).join(", ")})`).join("; ")}`);
  for (const seed of newPipelines) {
    const [created] = await db.insert(recruitPipeline).values({ code: seed.code, name: seed.name, nameEn: seed.nameEn, description: seed.description, isDefault: seed.isDefault }).returning();
    await db.insert(recruitPipelineStage).values(seed.stages.map((stage, index) => ({ pipelineId: created.id, key: stage.key, name: stage.name, nameEn: stage.nameEn, category: stage.category, sortOrder: index })));
  }
  console.log(`Seeded ${newPipelines.length} hiring pipelines with their stages (existing codes left untouched).`);

  // Candidate email wordings (FR-REC-05): drafts HR will rewrite, which is exactly why they are
  // rows and not code. Validated first — an unknown placeholder would reach a candidate as braces.
  const emailTemplateCodes = new Set((await db.select({ code: recruitEmailTemplate.code }).from(recruitEmailTemplate)).map((row) => row.code));
  const newEmailTemplates = EMAIL_TEMPLATE_SEED.filter((seed) => !emailTemplateCodes.has(seed.code));
  for (const seed of newEmailTemplates) {
    for (const draft of [{ subject: seed.subject, body: seed.body }, { subject: seed.subjectEn, body: seed.bodyEn }]) {
      const problems = emailTemplateProblems(draft);
      if (problems.length) throw new Error(`email template seed is invalid: ${seed.code} (${problems.join(", ")})`);
    }
  }
  if (newEmailTemplates.length) await db.insert(recruitEmailTemplate).values(newEmailTemplates.map((row) => ({ ...row })));
  console.log(`Seeded ${newEmailTemplates.length} candidate email templates (existing codes left untouched).`);

  // Company values for kudos (FR-COM-03): placeholders, only keys that do not exist yet.
  const valueKeys = new Set((await db.select({ key: companyValue.key }).from(companyValue)).map((row) => row.key));
  const newValues = STARTER_COMPANY_VALUES.filter((row) => !valueKeys.has(row.key));
  if (newValues.length) await db.insert(companyValue).values(newValues.map((row) => ({ ...row })));
  console.log(`Seeded ${newValues.length} company values (existing keys left untouched).`);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
