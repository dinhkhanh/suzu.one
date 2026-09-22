// KPI actuals proposed from work (FR-PJM-62) — the performance half.
//
// A KPI in the library may name a work metric (`kpi_definition.work_metric`). Early each month a
// job computes last month's figure for everyone measured on such a KPI and hands it here, and this
// file writes it as a **proposed** actual (`status = proposed`, `source = work`). Three rules hold:
//
//  1. **A proposal is never scored.** `dueLines` reads a proposed line as missing, so the
//     scorecard, the dashboards and the monthly close all ignore it until a person decides.
//  2. **The scorer decides, never the person.** The KPI's scorer is whoever may enter actuals for
//     the person (`canEnterActualsFor`): a manager above them, or HR — never the person themself,
//     the Phase 3.5 rule. Confirming or correcting goes through `saveActuals` like any other entry.
//  3. **Performance does not import PJM.** The figures are computed outside this module (the
//     reports module's job reads the PJM tables) and arrive here as numbers. HR modules pull.
//
// Idempotent: a line that already has an actual — entered, proposed or dismissed — is left alone,
// and a closed month is never touched.
import "server-only";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listPeopleHolding } from "@/modules/platform/rbac/service";
import { isWorkMetric, type KpiFrequency, type KpiUnit, periodDueIn, scoringMonthOf, WORK_METRIC_UNITS, type WorkMetric } from "./enums";
import { loadDirectory } from "./people";

/** One KPI line due in a month that is measured from work and still waits for its figure. */
export type WorkKpiLine = { assignmentId: string; personId: string; entityId: string; kpiId: string; kpiName: string; metric: WorkMetric; unit: KpiUnit; periodKey: string };

/**
 * Lines of work-sourced KPIs due in `month` with no actual yet, in entities whose month is still
 * open. A KPI whose unit does not fit its metric (changed after the metric was set) is skipped.
 */
export async function listWorkKpiDue(month: string): Promise<WorkKpiLine[]> {
  const rows = await db()
    .select({ assignment: schema.kpiAssignment, kpi: schema.kpiDefinition })
    .from(schema.kpiAssignment)
    .innerJoin(schema.kpiDefinition, eq(schema.kpiDefinition.id, schema.kpiAssignment.kpiId))
    .innerJoin(schema.person, eq(schema.person.id, schema.kpiAssignment.personId))
    .where(and(isNotNull(schema.kpiDefinition.workMetric), eq(schema.kpiDefinition.isActive, true), ne(schema.person.status, "offboarded"), lte(schema.kpiAssignment.fromPeriod, month), or(isNull(schema.kpiAssignment.toPeriod), gte(schema.kpiAssignment.toPeriod, month))));
  const due = rows.flatMap(({ assignment, kpi }) => {
    const periodKey = periodDueIn(kpi.frequency as KpiFrequency, month);
    if (!periodKey || !isWorkMetric(kpi.workMetric) || WORK_METRIC_UNITS[kpi.workMetric] !== kpi.unit) return [];
    return [{ assignmentId: assignment.id, personId: assignment.personId, entityId: assignment.entityId, kpiId: kpi.id, kpiName: kpi.name, metric: kpi.workMetric, unit: kpi.unit as KpiUnit, periodKey }];
  });
  if (due.length === 0) return [];
  const [existing, closed] = await Promise.all([
    db().select({ assignmentId: schema.kpiActual.assignmentId, periodKey: schema.kpiActual.periodKey }).from(schema.kpiActual).where(inArray(schema.kpiActual.assignmentId, due.map((line) => line.assignmentId))),
    db().select({ entityId: schema.kpiPeriod.entityId }).from(schema.kpiPeriod).where(and(eq(schema.kpiPeriod.month, month), eq(schema.kpiPeriod.status, "closed"))),
  ]);
  const taken = new Set(existing.map((row) => `${row.assignmentId}:${row.periodKey}`));
  const closedEntities = new Set(closed.map((row) => row.entityId));
  return due.filter((line) => !taken.has(`${line.assignmentId}:${line.periodKey}`) && !closedEntities.has(line.entityId));
}

export type WorkProposal = { line: WorkKpiLine; value: number };

/**
 * Writes the proposals and tells each line's scorer — the manager directly above the person, or,
 * for someone with no manager, HR over them. Never the person themself. Returns what was written;
 * a line somebody filled in the meantime is left as they left it.
 */
export async function proposeWorkActuals(proposals: readonly WorkProposal[]): Promise<{ proposed: number; notified: number }> {
  if (proposals.length === 0) return { proposed: 0, notified: 0 };
  const written = await db().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.kpiActual)
      .values(proposals.map(({ line, value }) => ({ assignmentId: line.assignmentId, personId: line.personId, kpiId: line.kpiId, periodKey: line.periodKey, actualValue: value, proposedValue: value, notApplicable: false, source: "work", status: "proposed", enteredByPersonId: null })))
      .onConflictDoNothing({ target: [schema.kpiActual.assignmentId, schema.kpiActual.periodKey] })
      .returning({ assignmentId: schema.kpiActual.assignmentId });
    const ids = new Set(inserted.map((row) => row.assignmentId));
    return proposals.filter(({ line }) => ids.has(line.assignmentId));
  });

  const directory = await loadDirectory();
  const scorers = new Map<string, Set<string>>();
  for (const { line } of written) {
    const person = directory.get(line.personId);
    const manager = person?.chainAbove[0];
    const recipients = manager ? [manager] : person ? await listPeopleHolding("performance:manage", person, { includeWildcard: false }) : [];
    const key = `${line.kpiName}\u0000${line.periodKey}`;
    for (const recipient of recipients) if (recipient !== line.personId) scorers.set(key, (scorers.get(key) ?? new Set()).add(recipient));
  }
  let notified = 0;
  for (const [key, recipients] of scorers) {
    const [kpi, period] = key.split("\u0000");
    await notify({ recipients: [...recipients], kind: "projects.kpi_proposed", params: { kpi, period }, link: `/performance/team/actuals?month=${scoringMonthOf(period)}` });
    notified += recipients.size;
  }
  return { proposed: written.length, notified };
}

/** The proposals still waiting on these lines, for the entry grid: assignment → proposed figure. */
export async function proposalsFor(lines: readonly { assignmentId: string; periodKey: string }[]): Promise<Map<string, number>> {
  if (lines.length === 0) return new Map();
  const rows = await db()
    .select({ assignmentId: schema.kpiActual.assignmentId, periodKey: schema.kpiActual.periodKey, value: schema.kpiActual.proposedValue })
    .from(schema.kpiActual)
    .where(and(inArray(schema.kpiActual.assignmentId, [...new Set(lines.map((line) => line.assignmentId))]), eq(schema.kpiActual.status, "proposed")));
  const wanted = new Set(lines.map((line) => `${line.assignmentId}:${line.periodKey}`));
  return new Map(rows.filter((row) => row.value !== null && wanted.has(`${row.assignmentId}:${row.periodKey}`)).map((row) => [row.assignmentId, row.value!]));
}
