// Phase 3.5 demo data for KPIs, called from seed-demo.ts after the goals. Idempotent: skipped once
// any KPI assignment exists. Rows are written straight into the tables the way the use-cases write
// them; every stored score comes from the same pure engine the monthly close uses, so closing the
// month again after a reopen reproduces it to the basis point.
//   July 2026   — closed for SZG, SZM and SZC
//   August 2026 — closed for SZM; closed for SZC over one missing actual (override, scored zero);
//                 SZG still open, blocked by one missing actual
//   September   — open, about half of the monthly actuals in; the quarter's figures not yet
import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { assignment, employment, entity, kpiActual, kpiAssignment, kpiDefinition, kpiPeriod, kpiScore, person, position, positionKpi } from "../src/lib/db/schema";
import { canonicalInputs, type KpiLineInput, kpiMonthScore } from "../src/modules/performance/engine/kpi-score";
import { type KpiDirection, type KpiFrequency, type KpiUnit, periodDueIn } from "../src/modules/performance/enums";
import { kpiSeedRows } from "../src/modules/performance/seed-kpis";
import { toSearchKey } from "../src/lib/text";

type Db = ReturnType<typeof drizzle>;
// [KPI code, weight, target in the KPI's own unit]
type Line = [string, number, number];

const TEMPLATES: Record<string, Line[]> = {
  "Chủ tịch": [["GROUP_REVENUE", 60, 12_000_000_000], ["GROUP_PROFIT_MARGIN", 40, 15]],
  "Tổng Giám đốc": [["TEAM_KPI_AVERAGE", 30, 90], ["GROUP_REVENUE", 40, 12_000_000_000], ["GROUP_PROFIT_MARGIN", 30, 15]],
  "Trưởng phòng Nhân sự": [["HR_PAYROLL_ACCURACY", 40, 99], ["HR_RECORDS_ON_TIME", 30, 95], ["HR_TIME_TO_HIRE", 30, 30]],
  "Chuyên viên Nhân sự": [["HR_RECORDS_ON_TIME", 50, 95], ["HR_PAYROLL_ACCURACY", 50, 99]],
  "Kế toán trưởng": [["FIN_CLOSE_DAYS", 40, 5], ["FIN_FILING_ON_TIME", 40, 100], ["FIN_RECEIVABLE_DAYS", 20, 45]],
  "Trưởng phòng Sản xuất Video": [["ON_TIME_DELIVERY", 40, 95], ["TEAM_KPI_AVERAGE", 30, 90], ["CLIENT_SATISFACTION", 30, 4.5]],
  "Đạo diễn": [["ON_TIME_DELIVERY", 40, 95], ["REVISION_ROUNDS", 30, 2], ["CLIENT_SATISFACTION", 30, 4.5]],
  "Dựng phim": [["ON_TIME_DELIVERY", 40, 95], ["CONTENT_OUTPUT", 40, 12], ["REVISION_ROUNDS", 20, 2]],
  "Quay phim": [["ON_TIME_DELIVERY", 50, 95], ["CONTENT_OUTPUT", 50, 8]],
  "Trưởng nhóm Thiết kế": [["ON_TIME_DELIVERY", 40, 95], ["TEAM_KPI_AVERAGE", 30, 90], ["CLIENT_SATISFACTION", 30, 4.5]],
  "Thiết kế đồ họa": [["ON_TIME_DELIVERY", 40, 95], ["CONTENT_OUTPUT", 40, 30], ["REVISION_ROUNDS", 20, 2]],
  "Social Media Executive": [["CONTENT_OUTPUT", 30, 40], ["ENGAGEMENT_RATE", 40, 4], ["CAMPAIGN_ROAS", 30, 3]],
  "Content Writer": [["CONTENT_OUTPUT", 50, 20], ["ON_TIME_DELIVERY", 30, 95], ["ENGAGEMENT_RATE", 20, 4]],
  "Account Executive": [["ACC_REVENUE", 50, 500_000_000], ["ACC_RETENTION", 25, 90], ["CLIENT_SATISFACTION", 25, 4.5]],
};

const FIRST_MONTH = "2026-07";
const MONTHS = ["2026-07", "2026-08", "2026-09"];
const scaleOf = (unit: KpiUnit) => (unit === "currency" ? 1 : 100);

// A steady, repeatable spread of results: 72 % … 123 % of target, from the text alone.
function factor(text: string): number {
  const digest = createHash("sha256").update(text).digest();
  return 0.72 + (digest.readUInt16BE(0) / 65535) * 0.51;
}

function actualFor(kpi: { unit: KpiUnit; direction: KpiDirection }, target: number, seed: string): number {
  const f = factor(seed);
  const raw = kpi.direction === "higher_better" ? target * f : target / f;
  // Whole VND to the nearest million; percentages never above 100; everything else on the unit's own scale.
  if (kpi.unit === "currency") return Math.round(raw / 1_000_000) * 1_000_000;
  const rounded = Math.round(raw);
  return kpi.unit === "percent" ? Math.min(rounded, 10_000) : Math.round(rounded / 10) * 10;
}

export async function seedKpis(db: Db): Promise<string> {
  if ((await db.select({ id: kpiAssignment.id }).from(kpiAssignment).limit(1)).length > 0) return "KPIs: assignments already seeded, skipped";
  const people = await db.select().from(person);
  const byName = new Map(people.map((row) => [row.fullName, row]));
  if (!byName.has("Nguyễn Thu Hà")) return "KPIs: demo people missing, skipped";

  // The library normally comes from `pnpm db:seed`; add what is missing so the demo stands alone.
  const known = new Set((await db.select({ code: kpiDefinition.code }).from(kpiDefinition)).map((row) => row.code));
  const missing = kpiSeedRows().filter((row) => !known.has(row.code));
  if (missing.length) await db.insert(kpiDefinition).values(missing);
  const kpis = new Map((await db.select().from(kpiDefinition)).map((row) => [row.code, row]));
  const positions = new Map((await db.select().from(position)).map((row) => [row.searchName, row]));
  const entities = new Map((await db.select().from(entity)).map((row) => [row.id, row.code]));
  const holders = await db.select({ personId: employment.personId, entityId: employment.entityId, startDate: employment.startDate, positionId: assignment.positionId }).from(assignment).innerJoin(employment, eq(employment.id, assignment.employmentId)).orderBy(desc(assignment.validFrom));
  const hrLead = byName.get("Lê Thị Mai")!;
  const hrSzm = byName.get("Phạm Quốc Bảo") ?? hrLead;

  const counts = { templates: 0, assignments: 0, actuals: 0, scores: 0, periods: 0 };
  await db.transaction(async (tx) => {
    // Templates: one group-wide set per demo position.
    for (const [positionName, lines] of Object.entries(TEMPLATES)) {
      const job = positions.get(toSearchKey(positionName));
      if (!job) continue;
      for (const [index, [code, weight, target]] of lines.entries()) {
        const kpi = kpis.get(code)!;
        await tx.insert(positionKpi).values({ positionId: job.id, entityId: null, kpiId: kpi.id, weight, targetValue: Math.round(target * scaleOf(kpi.unit as KpiUnit)), sortOrder: index + 1 }).onConflictDoNothing();
        counts.templates++;
      }
    }

    // Assignments: everyone, from July 2026 or the month they start, open-ended — so 2027 carries on.
    type Assigned = { id: string; personId: string; entityId: string; code: string; weight: number; targetValue: number; fromPeriod: string };
    const assigned: Assigned[] = [];
    const done = new Set<string>();
    for (const holder of holders) {
      // Someone transferred or promoted has several assignment rows: the latest one decides.
      if (done.has(holder.personId)) continue;
      done.add(holder.personId);
      const job = [...positions.values()].find((row) => row.id === holder.positionId);
      const lines = job ? Object.entries(TEMPLATES).find(([name]) => toSearchKey(name) === job.searchName)?.[1] : undefined;
      if (!job || !lines) continue;
      const fromPeriod = holder.startDate.slice(0, 7) > FIRST_MONTH ? holder.startDate.slice(0, 7) : FIRST_MONTH;
      for (const [code, weight, target] of lines) {
        const kpi = kpis.get(code)!;
        const targetValue = Math.round(target * scaleOf(kpi.unit as KpiUnit));
        const [row] = await tx.insert(kpiAssignment).values({ personId: holder.personId, entityId: holder.entityId, kpiId: kpi.id, weight, targetValue, fromPeriod, toPeriod: null, sourcePositionId: job.id, createdByPersonId: hrLead.id, createdAt: new Date("2026-06-25T03:00:00Z") }).returning();
        assigned.push({ id: row.id, personId: holder.personId, entityId: holder.entityId, code, weight, targetValue, fromPeriod });
        counts.assignments++;
      }
    }

    // Actuals, entered by the line manager (HR where there is none, or for HR's own manager-less rows).
    const nameOf = new Map(people.map((row) => [row.id, row.fullName]));
    const skip = (name: string, code: string, period: string) =>
      (name === "Huỳnh Mỹ Duyên" && code === "ENGAGEMENT_RATE" && period === "2026-08") || // SZC closes August over this gap
      (name === "Võ Minh Tuấn" && code === "FIN_CLOSE_DAYS" && period === "2026-08"); // SZG's August waits for this one
    const notApplicable = (name: string, code: string, period: string) => name === "Phan Văn Đức" && code === "CAMPAIGN_ROAS" && period === "2026-07";
    const linesOf = new Map<string, KpiLineInput[]>(); // `${entityId}:${month}:${personId}` → lines
    for (const month of MONTHS) {
      for (const item of assigned) {
        const kpi = kpis.get(item.code)!;
        const periodKey = periodDueIn(kpi.frequency as KpiFrequency, month);
        if (!periodKey || item.fromPeriod > month) continue;
        const name = nameOf.get(item.personId)!;
        const who = people.find((row) => row.id === item.personId)!;
        const line: KpiLineInput = { assignmentId: item.id, kpiCode: kpi.code, kpiName: kpi.name, unit: kpi.unit as KpiUnit, direction: kpi.direction as KpiDirection, frequency: kpi.frequency as KpiFrequency, periodKey, weight: item.weight, targetValue: item.targetValue, capBp: kpi.capBp, floorBp: kpi.floorBp, actualValue: null, notApplicable: false, note: null };
        // September is still running: every other monthly figure is in, the quarter's are not.
        const september = month === "2026-09" && (kpi.frequency === "quarterly" || factor(`${name}:${item.code}:sep`) < 0.97);
        if (!skip(name, item.code, periodKey) && !september) {
          const na = notApplicable(name, item.code, periodKey);
          line.actualValue = na ? null : actualFor({ unit: line.unit, direction: line.direction }, item.targetValue, `${name}:${item.code}:${periodKey}`);
          line.notApplicable = na;
          line.note = na ? "Tháng 7 không chạy chiến dịch trả phí" : null;
          const enteredAt = new Date(`${month === "2026-07" ? "2026-08-03" : month === "2026-08" ? "2026-09-02" : "2026-09-18"}T03:30:00Z`);
          await tx.insert(kpiActual).values({ assignmentId: item.id, personId: item.personId, kpiId: kpi.id, periodKey, actualValue: line.actualValue, notApplicable: na, note: line.note, source: "manual", enteredByPersonId: who.managerId ?? hrLead.id, createdAt: enteredAt, updatedAt: enteredAt });
          counts.actuals++;
        }
        const key = `${item.entityId}:${month}:${item.personId}`;
        linesOf.set(key, [...(linesOf.get(key) ?? []), line]);
      }
    }

    // The closes.
    const closes: { code: string; month: string; by: string; at: string; reason?: string }[] = [
      { code: "SZG", month: "2026-07", by: hrLead.id, at: "2026-08-05" },
      { code: "SZM", month: "2026-07", by: hrSzm.id, at: "2026-08-04" },
      { code: "SZC", month: "2026-07", by: hrLead.id, at: "2026-08-05" },
      { code: "SZM", month: "2026-08", by: hrSzm.id, at: "2026-09-03" },
      { code: "SZC", month: "2026-08", by: hrLead.id, at: "2026-09-04", reason: "Chưa có số liệu tương tác tháng 8 của kênh do Duyên phụ trách (đổi công cụ đo); chốt để kịp tổng hợp quý." },
    ];
    for (const close of closes) {
      const entityId = [...entities.entries()].find(([, code]) => code === close.code)?.[0];
      if (!entityId) continue;
      const at = new Date(`${close.at}T08:00:00Z`);
      const exceptions: { personId: string; kpiCode: string; periodKey: string }[] = [];
      for (const [key, lines] of linesOf) {
        const [lineEntity, month, personId] = key.split(":");
        if (lineEntity !== entityId || month !== close.month) continue;
        for (const line of lines) if (line.actualValue === null && !line.notApplicable) exceptions.push({ personId, kpiCode: line.kpiCode, periodKey: line.periodKey });
        const trace = kpiMonthScore(month, lines, { missingAs: "zero" });
        await tx.insert(kpiScore).values({ personId, entityId, month, revision: 1, scoreBp: trace.scoreBp, trace, inputsHash: createHash("sha256").update(canonicalInputs(month, lines, "zero")).digest("hex"), computedAt: at });
        counts.scores++;
      }
      await tx.insert(kpiPeriod).values({ entityId, month: close.month, status: "closed", closedByPersonId: close.by, closedAt: at, overrideReason: exceptions.length > 0 ? (close.reason ?? "Chốt khi còn thiếu số liệu") : null, exceptions: exceptions.length > 0 ? exceptions : null });
      counts.periods++;
    }
  });
  return `KPIs: ${counts.templates} template lines, ${counts.assignments} assignments, ${counts.actuals} actuals, ${counts.periods} closed months with ${counts.scores} stored scores`;
}
