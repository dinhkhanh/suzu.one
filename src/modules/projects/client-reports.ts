// Client reports (FR-PJM-58): the author picks a period, the figures come from the register, the
// publish log and its results, the milestones reached and the status updates; the author writes
// the summary and the plan for the next period; the PDF carries the entity's letterhead.
//
// The figures are computed when the report is read or printed, never stored: a report re-opened
// next week shows what is true then. What the figures may say is the engine's rule
// (`reportFigures`): no fee ever, internal hours only when the author ticks "show hours".
import "server-only";
import { and, asc, desc, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { sumLoggedMinutesByProject } from "../daily/service";
import type { LetterheadFields } from "../documents/service";
import { adapterPublishes } from "./delivery-adapter";
import { type ReportFigures, reportFigures } from "./engine/client-report";
import { monthOf } from "./engine/retainer";
import { withLineStatus } from "./metrics";
import { ensurePlan } from "./plans";

export type ClientReportRow = typeof schema.projectClientReport.$inferSelect;

export const findClientReport = async (reportId: string): Promise<ClientReportRow | undefined> => (await db().select().from(schema.projectClientReport).where(eq(schema.projectClientReport.id, reportId)).limit(1))[0];

export type ClientReportInput = { title: string; periodFrom: IsoDate; periodTo: IsoDate; summary: string | null; nextPlan: string | null; showHours: boolean };

export async function saveClientReport(projectId: string, reportId: string | null, input: ClientReportInput, actorPersonId: string): Promise<{ before: ClientReportRow | null; after: ClientReportRow }> {
  if (input.periodTo < input.periodFrom) throw new ActionError("plan_dates_invalid");
  await ensurePlan(projectId);
  if (!reportId) {
    const [after] = await db()
      .insert(schema.projectClientReport)
      .values({ projectId, ...input, createdByPersonId: actorPersonId })
      .returning();
    return { before: null, after };
  }
  const before = await findClientReport(reportId);
  if (!before || before.projectId !== projectId) throw new ActionError("report_not_found");
  const [after] = await db().update(schema.projectClientReport).set({ ...input, updatedAt: new Date() }).where(eq(schema.projectClientReport.id, reportId)).returning();
  return { before, after };
}

export async function listClientReports(projectId: string): Promise<(ClientReportRow & { authorName: string | null })[]> {
  const rows = await db()
    .select({ report: schema.projectClientReport, authorName: schema.person.fullName })
    .from(schema.projectClientReport)
    .leftJoin(schema.person, eq(schema.person.id, schema.projectClientReport.createdByPersonId))
    .where(eq(schema.projectClientReport.projectId, projectId))
    .orderBy(desc(schema.projectClientReport.periodTo), desc(schema.projectClientReport.createdAt));
  return rows.map(({ report, authorName }) => ({ ...report, authorName }));
}

/**
 * The period's figures. Register lines in the period: those due in it, the retainer months that
 * overlap it, and lines with no date at all (they belong to every period of the project).
 */
export async function clientReportFigures(projectId: string, period: { from: IsoDate; to: IsoDate }, options: { showHours: boolean }): Promise<ReportFigures> {
  const dayOf = (column: typeof schema.projectStatusUpdate.createdAt | typeof schema.projectMilestone.doneAt) => sql<string>`to_char(${column} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;
  const [lines, publishes, milestones, updates, hours] = await Promise.all([
    db()
      .select({ line: schema.projectDeliverable })
      .from(schema.projectDeliverable)
      .leftJoin(schema.projectRetainerPeriod, eq(schema.projectRetainerPeriod.id, schema.projectDeliverable.retainerPeriodId))
      .where(
        and(
          eq(schema.projectDeliverable.projectId, projectId),
          or(
            and(gte(schema.projectDeliverable.dueDate, period.from), lte(schema.projectDeliverable.dueDate, period.to)),
            and(isNotNull(schema.projectRetainerPeriod.month), gte(schema.projectRetainerPeriod.month, monthOf(period.from)), lte(schema.projectRetainerPeriod.month, monthOf(period.to))),
            and(sql`${schema.projectDeliverable.dueDate} is null`, sql`${schema.projectDeliverable.retainerPeriodId} is null`),
          ),
        ),
      )
      .orderBy(asc(schema.projectDeliverable.sortOrder), asc(schema.projectDeliverable.createdAt)),
    adapterPublishes(projectId, period),
    db()
      .select({ name: schema.projectMilestone.name, doneOn: dayOf(schema.projectMilestone.doneAt) })
      .from(schema.projectMilestone)
      .where(and(eq(schema.projectMilestone.projectId, projectId), isNotNull(schema.projectMilestone.doneAt))),
    db()
      .select({ on: dayOf(schema.projectStatusUpdate.createdAt), health: schema.projectStatusUpdate.health, summary: schema.projectStatusUpdate.summary })
      .from(schema.projectStatusUpdate)
      .where(eq(schema.projectStatusUpdate.projectId, projectId)),
    options.showHours ? sumLoggedMinutesByProject([projectId], period) : Promise.resolve(null),
  ]);
  const statused = (await withLineStatus(lines.map((row) => row.line))).filter((line) => line.status !== "cancelled");
  const logged = hours?.get(projectId);
  return reportFigures(
    {
      lines: statused.map((line) => ({ title: line.title, promised: line.promised, accepted: line.accepted, delivered: line.counts.delivered + line.counts.published })),
      publishes,
      milestones: milestones.map((row) => ({ name: row.name, doneOn: row.doneOn })),
      updates,
      hours: hours ? { loggedMinutes: logged?.minutes ?? 0, billableMinutes: logged?.billable ?? 0 } : null,
    },
    period,
    options,
  );
}

/** The entity's letterhead for the report PDF: its legal name, address, tax code and representative. */
export async function entityLetterhead(projectId: string): Promise<LetterheadFields> {
  const [row] = await db().select({ entity: schema.entity }).from(schema.workProject).leftJoin(schema.entity, eq(schema.entity.id, schema.workProject.entityId)).where(eq(schema.workProject.id, projectId)).limit(1);
  const entity = row?.entity;
  if (!entity) return {};
  return { companyName: entity.legalName, ...(entity.address ? { address: entity.address } : {}), ...(entity.taxCode ? { taxCode: entity.taxCode } : {}), ...(entity.legalRepresentative ? { representative: entity.legalRepresentative } : {}) };
}

/** The default period of a new report: this month so far. */
export const defaultReportPeriod = (today: IsoDate = todayInVietnam()): { from: IsoDate; to: IsoDate } => ({ from: `${monthOf(today)}-01`, to: today });
