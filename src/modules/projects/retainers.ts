// Retainers (FR-PJM-06): the monthly terms of a retainer project, the period made for each month
// with its own register lines, and what each month consumed of its quota.
//
// The midnight job makes the months (catching up on any it missed, oldest first, each carrying
// from the one before), closes the months that are over and bills each closed month's fee. Every
// step is idempotent: a period is unique per retainer and month, its lines are made with it in one
// transaction, and a month's fee item is unique per period. The morning job warns the account
// manager and the lead at 80% and 100% of any line, once per line and threshold.
import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import vi from "../../../messages/vi.json";
import { notify } from "../platform/notifications/service";
import { fireProjectAutomations } from "../work/service";
import { acceptedForBilling, ensureBillingItem } from "./billing";
import { unitsConsumed } from "./engine/register";
import { addMonths, hoursUsage, isMonth, lastDayOf, type Month, monthBounds, monthOf, monthsDue, monthsToMake, planPeriod, type PreviousPeriod, quotaAlertsDue, type RetainerRollover, type RetainerTerms, totalUsage, type Usage, usage } from "./engine/retainer";
import { loadLineUnits, withLineStatus } from "./metrics";
import { ensurePlan } from "./plans";
import type { RetainerLineTemplate } from "./schema";
import type { DeliverableRow } from "./structure";

type Executor = Tx | ReturnType<typeof db>;
export type RetainerRow = typeof schema.projectRetainer.$inferSelect;
export type PeriodRow = typeof schema.projectRetainerPeriod.$inferSelect;

// The description finance reads on a retainer month's billing item is stored with the item, so it
// is written once, in Vietnamese, from the messages — never a literal in the code (FR-PLT-02).
const label = createTranslator({ locale: "vi", messages: vi, namespace: "projects.retainer" });
export const retainerMonthLabel = (month: Month): string => label("billingDescription", { month });

export const getRetainer = async (projectId: string, executor: Executor = db()): Promise<RetainerRow | undefined> => (await executor.select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, projectId)).limit(1))[0];

// ── The terms ───────────────────────────────────────────────────────────────────────────────

export type RetainerInput = {
  startMonth: Month;
  endMonth: Month | null;
  lines: RetainerLineTemplate[];
  minutesPerMonth: number | null;
  rollover: RetainerRollover;
  isActive: boolean;
  /** Only written when given: the fee is `pjm:commercial`, and a reader without it never sends one. */
  feePerMonthVnd?: number | null;
};

/**
 * Sets a retainer's terms. Only a project of kind "retainer" has one. A change of the line
 * template applies from the next month made: a month already made keeps the lines it promised.
 *
 * The months are bounded (`monthBounds`): a retainer bills month after month, so its first month
 * may not be moved into the distant past — that would make hundreds of closed months, each with a
 * full month's fee — nor its last one years ahead. A month already stored is left alone, whatever
 * bounds it was saved under.
 */
export async function saveRetainer(projectId: string, input: RetainerInput): Promise<{ before: RetainerRow | null; after: RetainerRow }> {
  if (!isMonth(input.startMonth) || (input.endMonth && (!isMonth(input.endMonth) || input.endMonth < input.startMonth))) throw new ActionError("retainer_months_invalid");
  const titles = input.lines.map((line) => line.title.trim().toLowerCase());
  if (input.lines.length === 0) throw new ActionError("retainer_lines_required");
  // Lines are matched month to month by title: two lines of one title would share a carry.
  if (new Set(titles).size !== titles.length) throw new ActionError("retainer_lines_duplicate");
  return db().transaction(async (tx) => {
    const plan = await ensurePlan(projectId, tx);
    if (plan.kind !== "retainer") throw new ActionError("retainer_not_retainer_project");
    const [project] = await tx.select({ clientId: schema.workProject.clientId, startDate: schema.workProject.startDate }).from(schema.workProject).where(eq(schema.workProject.id, projectId)).limit(1);
    const before = (await getRetainer(projectId, tx)) ?? null;
    const bounds = monthBounds(monthOf(todayInVietnam(plan.createdAt)), monthOf(todayInVietnam()));
    const floor = project?.startDate && monthOf(project.startDate) < bounds.min ? monthOf(project.startDate) : bounds.min;
    for (const [month, stored] of [[input.startMonth, before?.startMonth], [input.endMonth, before?.endMonth]] as const) {
      if (!month || month === stored) continue;
      if (month < floor || month > bounds.max) throw new ActionError("retainer_month_out_of_range", { min: floor, max: bounds.max });
    }
    const { feePerMonthVnd, ...terms } = input;
    const values = { ...terms, clientId: project?.clientId ?? null, ...(feePerMonthVnd === undefined ? {} : { feePerMonthVnd }), updatedAt: new Date() };
    const [after] = before
      ? await tx.update(schema.projectRetainer).set(values).where(eq(schema.projectRetainer.id, before.id)).returning()
      : await tx
          .insert(schema.projectRetainer)
          .values({ projectId, ...values })
          .returning();
    return { before, after };
  });
}

/** A retainer as a reader gets it: the fee only for readers with `pjm:commercial`. */
export type RetainerView = Omit<RetainerRow, "feePerMonthVnd"> & { feePerMonthVnd?: number | null };
export function shapeRetainer(row: RetainerRow, seesFees: boolean): RetainerView {
  const { feePerMonthVnd, ...rest } = row;
  return seesFees ? { ...rest, feePerMonthVnd } : rest;
}

// ── Consumption ─────────────────────────────────────────────────────────────────────────────

export type PeriodLine = DeliverableRow & { consumed: number; usage: Usage; status: string };

/** Each period's lines with what they consumed (uncapped: overservicing shows). */
async function periodLines(periodIds: readonly string[]): Promise<Map<string, PeriodLine[]>> {
  const result = new Map<string, PeriodLine[]>(periodIds.map((id) => [id, []]));
  if (periodIds.length === 0) return result;
  const lines = await db().select().from(schema.projectDeliverable).where(inArray(schema.projectDeliverable.retainerPeriodId, [...periodIds])).orderBy(asc(schema.projectDeliverable.sortOrder), asc(schema.projectDeliverable.createdAt));
  const [units, statuses] = await Promise.all([loadLineUnits(lines.map((line) => line.id)), withLineStatus(lines)]);
  const statusOf = new Map(statuses.map((line) => [line.id, line.status]));
  for (const line of lines) {
    const consumed = line.cancelledAt ? 0 : unitsConsumed(units.get(line.id) ?? []);
    result.get(line.retainerPeriodId!)?.push({ ...line, consumed, usage: usage(line.cancelledAt ? 0 : line.quantity, consumed), status: statusOf.get(line.id) ?? "promised" });
  }
  return result;
}

const previousOf = (lines: readonly PeriodLine[]): PreviousPeriod => ({ lines: lines.filter((line) => !line.cancelledAt).map((line) => ({ title: line.title, quantity: line.quantity, consumed: line.consumed })) });

// ── Making and closing months ───────────────────────────────────────────────────────────────

const termsOf = (retainer: RetainerRow, project: { startDate: IsoDate | null; dueDate: IsoDate | null }): RetainerTerms => ({
  startMonth: retainer.startMonth,
  endMonth: retainer.endMonth,
  lines: retainer.lines,
  minutesPerMonth: retainer.minutesPerMonth,
  feePerMonthVnd: retainer.feePerMonthVnd,
  rollover: retainer.rollover as RetainerRollover,
  startDate: project.startDate,
  endDate: project.dueDate,
});

/**
 * Makes one month of a retainer if it does not exist yet, with its register lines, carrying from
 * the month before. The retainer row is locked, so two runs make the month once between them.
 * Last month's consumption is read before the transaction opens: it is the register's reading,
 * which the month being made does not change.
 */
async function makePeriod(retainerId: string, month: Month): Promise<PeriodRow | null> {
  const [previous] = await db().select().from(schema.projectRetainerPeriod).where(and(eq(schema.projectRetainerPeriod.retainerId, retainerId), eq(schema.projectRetainerPeriod.month, addMonths(month, -1)))).limit(1);
  const previousLines = previous ? ((await periodLines([previous.id])).get(previous.id) ?? []) : null;
  return db().transaction(async (tx) => {
    const [retainer] = await tx.select().from(schema.projectRetainer).where(eq(schema.projectRetainer.id, retainerId)).limit(1).for("update");
    if (!retainer) return null;
    const [existing] = await tx.select().from(schema.projectRetainerPeriod).where(and(eq(schema.projectRetainerPeriod.retainerId, retainerId), eq(schema.projectRetainerPeriod.month, month))).limit(1);
    if (existing) return null;
    const [project] = await tx.select({ startDate: schema.workProject.startDate, dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, retainer.projectId)).limit(1);
    const plan = planPeriod(termsOf(retainer, project ?? { startDate: null, dueDate: null }), month, previousLines ? previousOf(previousLines) : null);
    const [period] = await tx.insert(schema.projectRetainerPeriod).values({ retainerId, month, minutesAllowance: plan.minutesAllowance, carried: plan.carried }).onConflictDoNothing().returning();
    if (!period) return null;
    if (plan.lines.length) {
      await tx.insert(schema.projectDeliverable).values(plan.lines.map((line, index) => ({ projectId: retainer.projectId, retainerPeriodId: period.id, title: line.title, quantity: line.quantity, format: line.format, channel: line.channel, dueDate: lastDayOf(month), sortOrder: index })));
    }
    return period;
  });
}

/** The fee of one month: the month's share of the monthly fee (a part month pays its part). */
function periodFee(retainer: RetainerRow, project: { startDate: IsoDate | null; dueDate: IsoDate | null }, month: Month): number | null {
  return planPeriod({ ...termsOf(retainer, project), lines: [] }, month, null).feeVnd;
}

/** The fee of one month of a retainer, looked up by the period — for a retainer month's acceptance. */
export async function feeOfPeriod(executor: Executor, periodId: string): Promise<{ month: Month; feeVnd: number | null } | null> {
  const [row] = await executor.select({ period: schema.projectRetainerPeriod, retainer: schema.projectRetainer }).from(schema.projectRetainerPeriod).innerJoin(schema.projectRetainer, eq(schema.projectRetainer.id, schema.projectRetainerPeriod.retainerId)).where(eq(schema.projectRetainerPeriod.id, periodId)).limit(1);
  if (!row) return null;
  const [project] = await executor.select({ startDate: schema.workProject.startDate, dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, row.retainer.projectId)).limit(1);
  return { month: row.period.month, feeVnd: periodFee(row.retainer, project ?? { startDate: null, dueDate: null }, row.period.month) };
}

/**
 * Closes a month that is over and hands its fee to finance — both once. A retainer without a fee
 * closes its months all the same; there is simply nothing to bill.
 *
 * On **client** work the month closes on time but is not billed until the client has signed its
 * biên bản nghiệm thu (the owner's decision of 2026-09-23, Q22). Enforced here, at the one place a
 * month's fee becomes a billing item, rather than as a flag on the period: signing already makes
 * that same item, idempotently and under the acceptance's own transaction (`billSigned`), so the
 * signature simply becomes the only door. Closing the month stays a calendar fact — the quota, the
 * carry and the report are settled whether or not the paper has come back — and `awaitingAcceptance`
 * is what says the month is still owed.
 */
export async function closePeriod(periodId: string, actorPersonId: string | null = null): Promise<{ closed: boolean; billed: boolean; awaitingAcceptance?: boolean }> {
  return db().transaction(async (tx) => {
    const [period] = await tx.select().from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.id, periodId)).limit(1).for("update");
    if (!period) throw new ActionError("retainer_period_not_found");
    const [retainer] = await tx.select().from(schema.projectRetainer).where(eq(schema.projectRetainer.id, period.retainerId)).limit(1);
    const [project] = await tx.select({ clientId: schema.workProject.clientId, startDate: schema.workProject.startDate, dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, retainer.projectId)).limit(1);
    const closed = period.status === "open";
    if (closed) await tx.update(schema.projectRetainerPeriod).set({ status: "closed", closedAt: new Date() }).where(eq(schema.projectRetainerPeriod.id, periodId));
    const fee = periodFee(retainer, project ?? { startDate: null, dueDate: null }, period.month);
    if (!fee) return { closed, billed: false };
    if (project?.clientId && !(await acceptedForBilling(tx, retainer.projectId, { retainerPeriodId: period.id }))) return { closed, billed: false, awaitingAcceptance: true };
    const { created } = await ensureBillingItem(tx, { projectId: retainer.projectId, source: "retainer", retainerPeriodId: period.id, description: retainerMonthLabel(period.month), amountVnd: fee, createdByPersonId: actorPersonId });
    return { closed, billed: created };
  });
}

/**
 * The midnight job's work for every active retainer (or one): make the months due, oldest first,
 * then close the months that are over.
 */
export async function runRetainers(today: IsoDate, onlyRetainerId?: string): Promise<{ periods: number; closed: number; billed: number; awaiting: number }> {
  const retainers = await db()
    .select({ retainer: schema.projectRetainer, closedAt: schema.projectPlan.closedAt })
    .from(schema.projectRetainer)
    .leftJoin(schema.projectPlan, eq(schema.projectPlan.projectId, schema.projectRetainer.projectId))
    .where(onlyRetainerId ? eq(schema.projectRetainer.id, onlyRetainerId) : eq(schema.projectRetainer.isActive, true));
  // `awaiting`: months closed but not billed because the client has not signed their biên bản (Q22).
  const result = { periods: 0, closed: 0, billed: 0, awaiting: 0 };
  for (const { retainer, closedAt } of retainers) {
    // A closed project bills nothing more (FR-PJM-59): closing deactivates its retainer, and a row
    // that escaped that — closed before this rule, or closed while a run was under way — stops here.
    if (closedAt) continue;
    // Asked for one retainer by name (the page right after the terms are saved), a paused one makes nothing.
    if (!retainer.isActive) continue;
    // Never a month before the terms were saved, and never more than the catch-up in one run.
    const saved = monthOf(todayInVietnam(retainer.createdAt));
    for (const month of monthsToMake(monthsDue(retainer, today), saved, today)) if (await makePeriod(retainer.id, month)) result.periods += 1;
    const open = await db()
      .select({ id: schema.projectRetainerPeriod.id, month: schema.projectRetainerPeriod.month })
      .from(schema.projectRetainerPeriod)
      .where(and(eq(schema.projectRetainerPeriod.retainerId, retainer.id), eq(schema.projectRetainerPeriod.status, "open")))
      .orderBy(asc(schema.projectRetainerPeriod.month));
    for (const period of open.filter((row) => row.month < monthOf(today))) {
      const { closed, billed, awaitingAcceptance } = await closePeriod(period.id);
      if (closed) result.closed += 1;
      if (billed) result.billed += 1;
      if (awaitingAcceptance) result.awaiting += 1;
    }
  }
  return result;
}

// ── Quota alerts ────────────────────────────────────────────────────────────────────────────

async function recipientsOf(projectId: string): Promise<string[]> {
  const rows = await db().select({ personId: schema.workProjectMember.personId }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, projectId), inArray(schema.workProjectMember.role, ["lead", "account_manager"])));
  return [...new Set(rows.map((row) => row.personId))];
}

/** Lines of open months at 80% or 100% of their quota: the account manager and the lead, once per line and threshold. */
export async function sendQuotaAlerts(): Promise<{ alerts: number }> {
  const periods = await db()
    .select({ period: schema.projectRetainerPeriod, projectId: schema.projectRetainer.projectId, projectName: schema.workProject.name })
    .from(schema.projectRetainerPeriod)
    .innerJoin(schema.projectRetainer, eq(schema.projectRetainer.id, schema.projectRetainerPeriod.retainerId))
    .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectRetainer.projectId))
    .where(and(eq(schema.projectRetainerPeriod.status, "open"), eq(schema.projectRetainer.isActive, true)));
  const lines = await periodLines(periods.map((row) => row.period.id));
  let alerts = 0;
  for (const { period, projectId, projectName } of periods) {
    const due = (lines.get(period.id) ?? []).filter((line) => !line.cancelledAt).flatMap((line) => {
      const keys = quotaAlertsDue(line.id, line.usage.percent, period.alerted);
      return keys.length ? [{ line, keys }] : [];
    });
    if (due.length === 0) continue;
    const recipients = await recipientsOf(projectId);
    await db().transaction(async (tx) => {
      // Marked under the period's lock: a second run finds the marks and sends nothing.
      const [fresh] = await tx.select({ alerted: schema.projectRetainerPeriod.alerted }).from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.id, period.id)).limit(1).for("update");
      const marks = [...(fresh?.alerted ?? [])];
      for (const { line } of due) {
        const keys = quotaAlertsDue(line.id, line.usage.percent, marks);
        if (keys.length === 0) continue;
        marks.push(...keys);
        // One notice per line at its highest mark, however many thresholds it jumped.
        await notify({ recipients, kind: "projects.quota_alert", params: { project: projectName, line: line.title, percent: line.usage.percent ?? 0 }, link: `/projects/${projectId}/retainer` }, tx);
        alerts += 1;
        // The team's own rules on a quota mark (FR-PJM-33), once per line and threshold like the notice.
        for (const key of keys) await fireProjectAutomations(tx, projectId, { type: "quota_threshold", percent: Number(key.slice(key.lastIndexOf(":") + 1)), key });
      }
      await tx.update(schema.projectRetainerPeriod).set({ alerted: marks }).where(eq(schema.projectRetainerPeriod.id, period.id));
    });
  }
  return { alerts };
}

// ── The retainer page and its monthly report ────────────────────────────────────────────────

export type PeriodView = {
  period: PeriodRow;
  lines: PeriodLine[];
  total: Usage;
  hours: Usage | null;
  loggedMinutes: number;
  /** The month's fee and its billing item — only for readers with `pjm:commercial`. */
  feeVnd?: number | null;
  billing: { status: string; invoiceNumber: string | null } | null;
};

/** Minutes logged per project and month ("<projectId> <month>"), for any projects, in one query. */
async function minutesByProjectMonth(projectIds: readonly string[], months?: { from: Month; to: Month }): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const month = sql<string>`to_char(${schema.timeEntry.date}, 'YYYY-MM')`;
  const onProject = sql<string>`coalesce(${schema.timeEntry.projectId}, ${schema.workTask.projectId})`;
  const rows = await db()
    .select({ projectId: onProject, month, minutes: sql<number>`coalesce(sum(${schema.timeEntry.minutes}), 0)::int` })
    .from(schema.timeEntry)
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.timeEntry.taskId))
    .where(
      and(
        isNull(schema.timeEntry.deletedAt),
        // As the hours burn counts them: on the project itself, or on one of its tasks.
        or(inArray(schema.timeEntry.projectId, [...projectIds]), inArray(schema.workTask.projectId, [...projectIds])),
        months ? sql`${schema.timeEntry.date} >= ${`${months.from}-01`}::date and ${schema.timeEntry.date} <= ${lastDayOf(months.to)}::date` : undefined,
      ),
    )
    .groupBy(onProject, month);
  return new Map(rows.map((row) => [`${row.projectId} ${row.month}`, Number(row.minutes)]));
}

/**
 * What a month consumed, counted one way for the retainer page, its report and the delivery
 * dashboard: units consumed ÷ units contracted over the month's live lines (the register engine's
 * reading of each unit), uncapped.
 */
const periodTotal = (lines: readonly PeriodLine[]): Usage => totalUsage(lines.filter((line) => !line.cancelledAt).map((line) => ({ contracted: line.quantity, consumed: line.consumed })));

/** Every month of a retainer, newest first, with consumption, hours and — for `pjm:commercial` — the fee. */
export async function listPeriods(retainer: RetainerRow, seesFees: boolean): Promise<PeriodView[]> {
  const periods = await db().select().from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.retainerId, retainer.id)).orderBy(asc(schema.projectRetainerPeriod.month));
  const ids = periods.map((period) => period.id);
  const [lines, minutes, items, project] = await Promise.all([
    periodLines(ids),
    minutesByProjectMonth([retainer.projectId]),
    ids.length ? db().select().from(schema.projectBillingItem).where(and(inArray(schema.projectBillingItem.retainerPeriodId, ids), eq(schema.projectBillingItem.source, "retainer"))) : Promise.resolve([]),
    db().select({ startDate: schema.workProject.startDate, dueDate: schema.workProject.dueDate }).from(schema.workProject).where(eq(schema.workProject.id, retainer.projectId)).limit(1),
  ]);
  const itemOf = new Map(items.map((item) => [item.retainerPeriodId, item]));
  return periods
    .map((period) => {
      const own = lines.get(period.id) ?? [];
      const logged = minutes.get(`${retainer.projectId} ${period.month}`) ?? 0;
      const item = itemOf.get(period.id);
      return {
        period,
        lines: own,
        total: periodTotal(own),
        hours: hoursUsage(period.minutesAllowance, logged),
        loggedMinutes: logged,
        ...(seesFees ? { feeVnd: periodFee(retainer, project[0] ?? { startDate: null, dueDate: null }, period.month) } : {}),
        billing: item ? { status: item.status, invoiceNumber: item.invoiceNumber } : null,
      };
    })
    .reverse();
}

/** One retainer month as the delivery dashboard reads it (FR-PJM-60): units and hours, never money. */
export type RetainerConsumption = { projectId: string; month: Month; contracted: number; delivered: number; minutesAllowance: number | null; minutesLogged: number };

/**
 * Consumption of every retainer month of these projects whose month falls in the date range —
 * the same figures the retainer page shows (`periodTotal`, and minutes logged in the month), for
 * many projects in a fixed number of queries. No authorization: the caller passes projects the
 * reader may already open. No fee: this is read by people without `pjm:commercial`.
 */
export async function retainerConsumption(projectIds: readonly string[], range: { from: IsoDate; to: IsoDate }): Promise<RetainerConsumption[]> {
  if (projectIds.length === 0 || range.to < range.from) return [];
  const months = { from: monthOf(range.from), to: monthOf(range.to) };
  const periods = await db()
    .select({ id: schema.projectRetainerPeriod.id, month: schema.projectRetainerPeriod.month, minutesAllowance: schema.projectRetainerPeriod.minutesAllowance, projectId: schema.projectRetainer.projectId })
    .from(schema.projectRetainerPeriod)
    .innerJoin(schema.projectRetainer, eq(schema.projectRetainer.id, schema.projectRetainerPeriod.retainerId))
    .where(and(inArray(schema.projectRetainer.projectId, [...projectIds]), sql`${schema.projectRetainerPeriod.month} between ${months.from} and ${months.to}`))
    .orderBy(asc(schema.projectRetainer.projectId), asc(schema.projectRetainerPeriod.month));
  if (periods.length === 0) return [];
  const [lines, minutes] = await Promise.all([periodLines(periods.map((period) => period.id)), minutesByProjectMonth([...new Set(periods.map((period) => period.projectId))], months)]);
  return periods.map((period) => {
    const total = periodTotal(lines.get(period.id) ?? []);
    return { projectId: period.projectId, month: period.month, contracted: total.contracted, delivered: total.consumed, minutesAllowance: period.minutesAllowance, minutesLogged: minutes.get(`${period.projectId} ${period.month}`) ?? 0 };
  });
}

/** The retainer period of a project, for the actions' checks. */
export async function findPeriod(periodId: string): Promise<(PeriodRow & { projectId: string }) | undefined> {
  const [row] = await db().select({ period: schema.projectRetainerPeriod, projectId: schema.projectRetainer.projectId }).from(schema.projectRetainerPeriod).innerJoin(schema.projectRetainer, eq(schema.projectRetainer.id, schema.projectRetainerPeriod.retainerId)).where(eq(schema.projectRetainerPeriod.id, periodId)).limit(1);
  return row ? { ...row.period, projectId: row.projectId } : undefined;
}

/** The months of a project's retainer, for choosing one to accept. */
export async function listPeriodOptions(projectId: string): Promise<{ id: string; month: Month; status: string }[]> {
  return db()
    .select({ id: schema.projectRetainerPeriod.id, month: schema.projectRetainerPeriod.month, status: schema.projectRetainerPeriod.status })
    .from(schema.projectRetainerPeriod)
    .innerJoin(schema.projectRetainer, eq(schema.projectRetainer.id, schema.projectRetainerPeriod.retainerId))
    .where(eq(schema.projectRetainer.projectId, projectId))
    .orderBy(asc(schema.projectRetainerPeriod.month));
}

/** This month as the job would make it, for the page right after the terms are saved. */
export const ensureCurrentPeriods = (retainerId: string): Promise<{ periods: number; closed: number; billed: number; awaiting: number }> => runRetainers(todayInVietnam(), retainerId);
