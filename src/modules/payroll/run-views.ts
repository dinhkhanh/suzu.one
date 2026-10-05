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
import { listPayrollNames } from "@/modules/core-hr/service";
import { recordAudit } from "@/modules/platform/audit/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { CalculationContext } from "./calculation";
import type { PayInput, PersonPayResult } from "./engine/types";
import { availableSteps, type PayrollRunEventRow, type RunStep } from "./lifecycle";
import { componentNamesOf, payslipPersonOf, type PayslipView } from "./payslips";
import { canManageCompensation, canReadPayroll, payrollReadReach } from "./policy";
import { ALL_MONTHS, listRetroItems, listRetroItemsOnRun, listUnpricedAdjustments, type RetroItemView, type UnpricedAdjustment } from "./retro";
import { type CalcProgress, progressOf } from "./run-calculation";
import { getRunReadiness, type RunReadiness } from "./run-readiness";
import { loadRunPeople, openResult, openTotals, type PayrollRunRow, type RunTotals } from "./run-storage";
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

/** A retro item as the screens show it: whose it is, and whether the run this screen is about pays them. */
export type RetroScreenRow = RetroItemView & { fullName: string; employeeCode: string | null; createdByName: string | null; /** False on a run screen when the person is not in the run: the item stays waiting. */ inRun: boolean };
export type UnpricedScreenRow = UnpricedAdjustment & { fullName: string; employeeCode: string | null };
export type RetroScreen = { items: RetroScreenRow[]; unpriced: UnpricedScreenRow[] };

export type RunView = {
  run: PayrollRunRow;
  entity: { id: string; code: string; shortName: string };
  totals: RunTotals;
  progress: CalcProgress;
  /** Every step with the name of whoever took it (null: a job, or nobody on record). */
  events: (PayrollRunEventRow & { actorName: string | null })[];
  people: RunPersonRow[];
  variance: RunVariance;
  steps: RunStep[];
  /** True for C&B over this entity and for the owner: the per-person detail is filled in. */
  seesPayslips: boolean;
  /** Statutory values nobody has confirmed yet — shown on the run until the accountant does. */
  unverifiedParameters: string[];
  /** Whether the run may be proposed as it stands, and what is in the way (`run-readiness.ts`). Names of rules and people — no figure. */
  readiness: RunReadiness;
  /** Who the people named by `readiness` are, when they are not in the run or the month before. */
  names: ReadonlyMap<string, { fullName: string; employeeCode: string | null }>;
  /** The retro items this run carries or would carry, and the corrections nobody has priced — C&B only, a regular run only. */
  retro: RetroScreen | null;
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
    db()
      .select({ event: schema.payrollRunEvent, actorName: schema.person.fullName })
      .from(schema.payrollRunEvent)
      .leftJoin(schema.person, eq(schema.person.id, schema.payrollRunEvent.actorPersonId))
      .where(eq(schema.payrollRunEvent.runId, runId))
      .orderBy(schema.payrollRunEvent.createdAt),
    getRunVariance(run),
    seesPayslips ? listRunInputs(runId) : Promise.resolve(new Map<string, PayInput[]>()),
  ]);
  // The readiness check reuses the comparison just made; the retro items are compensation.
  const [readiness, retroItems, unpriced] = await Promise.all([
    getRunReadiness(run, { variance }),
    seesPayslips && run.kind === "regular" ? listRetroItemsOnRun(run) : Promise.resolve(null),
    seesPayslips && run.kind === "regular" && (run.status === "draft" || run.status === "calculated") ? listUnpricedAdjustments(run.entityId, run.month) : Promise.resolve([]),
  ]);
  const inRun = new Set(personRows.map((person) => person.row.personId));
  // One read for every name the variance check does not already hold.
  const strangers = [...new Set([...readiness.blockers, ...readiness.warnings].map((issue) => issue.personId).concat((retroItems ?? []).flatMap((item) => [item.personId, ...(item.createdByPersonId ? [item.createdByPersonId] : [])]), unpriced.map((row) => row.personId)))].filter((personId) => !variance.names.has(personId));
  const names = new Map([...variance.names, ...(await listPayrollNames(strangers)).map((row) => [row.personId, { fullName: row.fullName, employeeCode: row.employeeCode }] as const)]);
  const named = (personId: string) => ({ fullName: names.get(personId)?.fullName ?? "—", employeeCode: names.get(personId)?.employeeCode ?? null });

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
    events: events.map(({ event, actorName }) => ({ ...event, actorName })),
    people,
    variance,
    steps: availableSteps(run),
    seesPayslips,
    unverifiedParameters: (run.context as { unverifiedParameters?: string[] } | null)?.unverifiedParameters ?? [],
    readiness,
    names,
    retro: retroItems ? { items: retroItems.map((item) => ({ ...item, ...named(item.personId), createdByName: item.createdByPersonId ? (names.get(item.createdByPersonId)?.fullName ?? null) : null, inRun: inRun.has(item.personId) })), unpriced: unpriced.map((row) => ({ ...row, ...named(row.personId) })) } : null,
  };
}

/**
 * The entity's retro items that no run has carried yet, and the corrections waiting to be priced
 * by hand — C&B's list between runs. null = the viewer does not manage this entity's compensation.
 */
export async function getRetroScreen(principal: Principal, entityId: string): Promise<RetroScreen | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  // No run is being prepared here, so every month already behind us is in scope.
  const [items, unpriced] = await Promise.all([listRetroItems({ entityIds: [entityId], status: "open" }), listUnpricedAdjustments(entityId, ALL_MONTHS)]);
  const names = new Map((await listPayrollNames([...items.flatMap((item) => [item.personId, ...(item.createdByPersonId ? [item.createdByPersonId] : [])]), ...unpriced.map((row) => row.personId)])).map((row) => [row.personId, row]));
  const named = (personId: string) => ({ fullName: names.get(personId)?.fullName ?? "—", employeeCode: names.get(personId)?.employeeCode ?? null });
  return {
    items: items.map((item) => ({ ...item, ...named(item.personId), createdByName: item.createdByPersonId ? (names.get(item.createdByPersonId)?.fullName ?? null) : null, inRun: true })),
    unpriced: unpriced.map((row) => ({ ...row, ...named(row.personId) })),
  };
}

// ── One person's lines, before anything is published (FR-PAY-20, FR-PAY-31) ─────────────────

export type RunPersonHandle = { run: PayrollRunRow; entity: PayslipView["entity"]; row: typeof schema.payrollRunPerson.$inferSelect };

/**
 * Finds one person's line in a run — for C&B over the run's entity and the owner, the same people
 * who see every figure on the run screen. null = no such line, or not theirs: one answer for both.
 * Nothing is decrypted and nothing is recorded here; the page calls this before it asks for a
 * fresh re-authentication, and `openRunPerson` after.
 */
export async function findRunPerson(principal: Principal, runId: string, personId: string): Promise<RunPersonHandle | null> {
  const [found] = await db()
    .select({
      run: schema.payrollRun,
      entity: { id: schema.entity.id, code: schema.entity.code, legalName: schema.entity.legalName, shortName: schema.entity.shortName, taxCode: schema.entity.taxCode, address: schema.entity.address },
      row: schema.payrollRunPerson,
    })
    .from(schema.payrollRunPerson)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollRunPerson.runId))
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payrollRun.entityId))
    .where(and(eq(schema.payrollRunPerson.runId, runId), eq(schema.payrollRunPerson.personId, personId)))
    .limit(1);
  if (!found || !canManageCompensation(principal, found.run)) return null;
  return found;
}

export type RunPersonReader = { userId?: string | null; email?: string | null; person: { id: string }; request?: { ipAddress?: string | null; userAgent?: string | null } };

export type RunPersonView = {
  run: PayrollRunRow;
  entity: PayslipView["entity"];
  person: PayslipView["person"];
  result: PersonPayResult;
  /** Component code → the name it had when the run was calculated (FR-PAY-20). */
  componentNames: ReadonlyMap<string, string>;
  /** Figures typed into the run for them. */
  inputs: { code: string; amount: number; note: string | null }[];
};

/**
 * Opens the line: every figure, the working and the explanation trace — what the payslip will
 * say, read before it is proposed. This is a read of somebody's compensation, so it is written to
 * the audit log (FR-PLT-33): who read whose line in which run, and never a figure.
 */
export async function openRunPerson(reader: RunPersonReader, handle: RunPersonHandle): Promise<RunPersonView> {
  const { run, entity, row } = handle;
  const [person, componentNames, inputs] = await Promise.all([payslipPersonOf(row.personId), componentNamesOf(run.context as CalculationContext | null, run.entityId, run.month), listRunInputs(run.id, db(), row.personId)]);
  await recordAudit({
    action: "payroll_run.person.read",
    actor: { userId: reader.userId ?? null, personId: reader.person.id, email: reader.email ?? null },
    request: reader.request,
    resource: { type: "payroll_run", id: run.id, entityId: run.entityId },
    summary: `${run.month} line read`,
    after: { personId: row.personId, status: run.status },
  });
  return { run, entity, person, result: openResult(row), componentNames, inputs: (inputs.get(row.personId) ?? []).map((line) => ({ code: line.code, amount: line.amount, note: line.note ?? null })) };
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
