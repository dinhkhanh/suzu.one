// What the run screens read. Authorization is **inside** these functions (unlike `runs.ts`), so a
// page is a thin caller: a run outside the viewer's reach comes back as null and the page 404s —
// the same answer as a run that does not exist, so an id tells a stranger nothing (no IDOR oracle).
//
// Two levels of sight, deliberately different (SRS §2.2, FR-PAY-31, FR-PAY-32):
//
//   payroll:read     over the entity — the register, the run's totals, and the variance list with
//                    each person's net and how it moved. This is what the CEO signs against and
//                    what the chief accountant and an auditor work from.
//   payroll:propose  over the entity (C&B), or the owner — the same plus every person's full
//                    result: each line, the insurance and PIT working, the explanation trace.
//                    A payslip belongs to its owner, C&B and the owner of the company; nobody
//                    else's screen ever holds one.
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { PayInput, PersonPayResult } from "./engine/types";
import { availableSteps, listRunEvents, type PayrollRunEventRow, type RunStep } from "./lifecycle";
import { canManageCompensation, canReadPayroll, payrollReadReach } from "./policy";
import { type CalcProgress, progressOf } from "./run-calculation";
import { loadRunPeople, openTotals, type PayrollRunRow, type RunTotals } from "./run-storage";
import { listRunInputs } from "./runs";
import { getRunVariance, type RunVariance } from "./variance";

export type RunListRow = {
  id: string;
  entityId: string;
  entityCode: string;
  month: string;
  kind: PayrollRunRow["kind"];
  status: PayrollRunRow["status"];
  name: string | null;
  headcount: number;
  calcState: PayrollRunRow["calcState"];
  /** Only for someone who may read the entity's payroll — which, here, everyone listed already may. */
  net: number | null;
  paidAt: Date | null;
};

/** The run register of every entity the viewer may read payroll for, newest month first. */
export async function listRunsForViewer(principal: Principal, filter: { entityId?: string | null; month?: string | null } = {}): Promise<RunListRow[]> {
  const reach = payrollReadReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return [];
  // Filtered in SQL: a viewer never loads a row they may not see and then hides it.
  const rows = await db()
    .select({ run: schema.payrollRun, entityCode: schema.entity.code })
    .from(schema.payrollRun)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payrollRun.entityId))
    .where(
      and(
        reach.all ? undefined : inArray(schema.payrollRun.entityId, reach.entityIds),
        filter.entityId ? eq(schema.payrollRun.entityId, filter.entityId) : undefined,
        filter.month ? eq(schema.payrollRun.month, filter.month) : undefined,
      ),
    )
    .orderBy(desc(schema.payrollRun.month), desc(schema.payrollRun.createdAt))
    .limit(200);

  return rows.map(({ run, entityCode }) => ({
    id: run.id,
    entityId: run.entityId,
    entityCode,
    month: run.month,
    kind: run.kind,
    status: run.status,
    name: run.name,
    headcount: run.headcount,
    calcState: run.calcState,
    net: run.totalsEnc ? openTotals(run).net : null,
    paidAt: run.paidAt,
  }));
}

export type RunPersonRow = {
  personId: string;
  fullName: string;
  employeeCode: string | null;
  profile: "statutory" | "simple";
  net: number;
  warnings: readonly string[];
  /** Everything about this person's pay — only for a viewer who may see payslips. */
  result: PersonPayResult | null;
  /** Figures typed into the run for them (a bonus, an advance), same condition. */
  inputs: { code: string; amount: number; note: string | null }[];
};

export type RunView = {
  run: PayrollRunRow;
  entity: { id: string; code: string; shortName: string };
  totals: RunTotals;
  progress: CalcProgress;
  events: PayrollRunEventRow[];
  people: RunPersonRow[];
  variance: RunVariance;
  steps: RunStep[];
  /** True for C&B over this entity and for the owner: the per-person detail is filled in. */
  seesPayslips: boolean;
  /** Statutory values nobody has confirmed yet — shown on the run until the accountant does. */
  unverifiedParameters: string[];
};

/** One run, as much of it as the viewer may see. null = not there, or not theirs. */
export async function getRunView(principal: Principal, runId: string): Promise<RunView | null> {
  const [found] = await db()
    .select({ run: schema.payrollRun, entity: { id: schema.entity.id, code: schema.entity.code, shortName: schema.entity.shortName } })
    .from(schema.payrollRun)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payrollRun.entityId))
    .where(eq(schema.payrollRun.id, runId))
    .limit(1);
  if (!found || !canReadPayroll(principal, found.run)) return null;

  const { run, entity } = found;
  const seesPayslips = canManageCompensation(principal, run);
  // The variance check reads the same people (shared for the request) and already knows their names.
  const [personRows, events, variance, inputs] = await Promise.all([
    loadRunPeople(runId),
    listRunEvents(runId),
    getRunVariance(run),
    seesPayslips ? listRunInputs(runId) : Promise.resolve(new Map<string, PayInput[]>()),
  ]);

  const people = personRows
    .map(({ row, result }): RunPersonRow => {
      const fact = variance.names.get(row.personId);
      return {
        personId: row.personId,
        fullName: fact?.fullName ?? "—",
        employeeCode: fact?.employeeCode ?? null,
        profile: row.profile,
        net: result.totals.net,
        warnings: row.warnings,
        result: seesPayslips ? result : null,
        inputs: (inputs.get(row.personId) ?? []).map((line) => ({ code: line.code, amount: line.amount, note: line.note ?? null })),
      };
    })
    .sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") || left.fullName.localeCompare(right.fullName));

  return {
    run,
    entity,
    totals: openTotals(run),
    progress: progressOf(run),
    events,
    people,
    variance,
    steps: availableSteps(run),
    seesPayslips,
    unverifiedParameters: (run.context as { unverifiedParameters?: string[] } | null)?.unverifiedParameters ?? [],
  };
}

/** The months an entity could still be run for: what the "new run" form offers. */
export async function listRunnableMonths(entityId: string, limit = 6): Promise<{ month: string; lockedAt: Date; hasRun: boolean }[]> {
  return (await listRunnableMonthsOf([entityId], limit)).map((row) => ({ month: row.month, lockedAt: row.lockedAt, hasRun: row.hasRun }));
}

/** The same for several entities in one round trip: the latest `limit` locked months of each. */
export async function listRunnableMonthsOf(entityIds: readonly string[], limit = 6): Promise<{ entityId: string; month: string; lockedAt: Date; hasRun: boolean }[]> {
  if (entityIds.length === 0) return [];
  const [locked, runs] = await Promise.all([
    db()
      .select({ entityId: schema.timesheetPeriod.entityId, month: schema.timesheetPeriod.month, lockedAt: schema.timesheetPeriod.lockedAt })
      .from(schema.timesheetPeriod)
      .where(and(inArray(schema.timesheetPeriod.entityId, [...entityIds]), eq(schema.timesheetPeriod.status, "locked")))
      .orderBy(desc(schema.timesheetPeriod.month)),
    db().select({ entityId: schema.payrollRun.entityId, month: schema.payrollRun.month, status: schema.payrollRun.status }).from(schema.payrollRun).where(and(inArray(schema.payrollRun.entityId, [...entityIds]), eq(schema.payrollRun.kind, "regular"))),
  ]);
  const taken = new Set(runs.filter((row) => row.status !== "cancelled").map((row) => `${row.entityId}:${row.month}`));
  const seen = new Map<string, number>();
  return locked.flatMap((row) => {
    // Newest first per entity, the first `limit` of each — what a LIMIT per entity would have kept.
    const count = seen.get(row.entityId) ?? 0;
    seen.set(row.entityId, count + 1);
    if (count >= limit || !row.lockedAt) return [];
    return [{ entityId: row.entityId, month: row.month, lockedAt: row.lockedAt, hasRun: taken.has(`${row.entityId}:${row.month}`) }];
  });
}
