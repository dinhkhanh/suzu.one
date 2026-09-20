// The scheduler (FR-OPS-02, 04): turns the library into dated, owned instances.
//
// Recurring templates: every period whose due date falls inside the horizon gets one instance per
// applicable entity. Event-driven templates: *pulled* from core-hr's lifecycle events — those rows
// are written in the same transaction as the hire, the termination or the approved long leave, so
// they are the durable event log and no outbox is needed; core-hr knows nothing of this module.
// Everything is idempotent through the unique key (template, entity, period key): the job runs in
// both cron schedules and behind the "Sync now" button.
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getDaysOff, isPeriodLocked } from "@/modules/attendance/service";
import { hasReached, listRunMilestones, type RunStatus } from "@/modules/payroll/service";
import { type LifecycleEventFact, listLifecycleEventFacts } from "@/modules/core-hr/service";
import { notify } from "../platform/notifications/service";
import type { Permission, Role } from "../platform/rbac/roles";
import { listPeopleHolding, listPeopleWithRole } from "../platform/rbac/service";
import { createTasks } from "../platform/tasks-engine/service";
import { nominalDueDate, type Period, periodsDueBetween, shiftDueDate } from "./engine/due-rule";
import { OBLIGATION_KIND, type ObligationEventType, type PeriodicRecurrence, type Shift } from "./enums";
import type { ObligationTemplateRow } from "./templates";

type Executor = Tx | ReturnType<typeof db>;

export const DEFAULT_HORIZON_DAYS = 100;
/** An event older than this when the scheduler first sees it is history (an import of existing staff), not a duty. */
export const EVENT_LOOKBACK_DAYS = 60;
/** The library code of the monthly timesheet lock — closed by the scheduler once attendance says the month is locked (FR-OPS-10, lite). */
export const TIMESHEET_LOCK_CODE = "INT-TIMESHEET-LOCK";

/**
 * The monthly payroll calendar (FR-OPS-10, SRS D17): each of these closes itself when payroll
 * reports that the run of that month has got that far. Pulled and idempotent, exactly like the
 * timesheet lock above — payroll writes nothing here, and this module only ever asks it
 * `listRunMilestones`, which carries statuses and dates, never a figure.
 *
 * "Phát hành phiếu lương" (INT-PAYSLIP-RELEASE) is not here: payslips are published in week 5,
 * and it closes when they are.
 */
const PAYROLL_MILESTONES: { code: string; reached: RunStatus }[] = [
  { code: "INT-PAYROLL-PROPOSE", reached: "proposed" },
  { code: "INT-PAYROLL-SIGN", reached: "approved" },
  { code: "INT-SALARY-PAYMENT", reached: "paid" },
];

const LIFECYCLE_TYPE: Record<ObligationEventType, LifecycleEventFact["type"]> = { hire: "hire", rehire: "rehire", termination: "termination", long_leave: "long_leave", salary_change: "salary_change", long_leave_return: "long_leave" };

/** "08/2026", "Q3/2026", "H2/2026", "2026". */
export function periodLabel(key: string): string {
  const [year, part] = key.split("-");
  return part ? `${part}/${year}` : year;
}

const OPEN = ["todo", "in_progress"] as const;

export type GenerateOptions = { /** Start of the due-date window; default today — the past is not back-filled. */ from?: IsoDate; horizonDays?: number; actorId?: string | null; executor?: Executor; now?: Date };
export type GenerateResult = { created: number; fromEvents: number; cancelled: number; autoCompleted: number; unassigned: number };

export async function generateInstances(today: IsoDate, options: GenerateOptions = {}): Promise<GenerateResult> {
  if (options.executor) return generateIn(options.executor, today, options);
  return db().transaction((tx) => generateIn(tx, today, options));
}

async function generateIn(tx: Executor, today: IsoDate, options: GenerateOptions): Promise<GenerateResult> {
  const from = options.from ?? today;
  const to = addDays(today, options.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const now = options.now ?? new Date();

  const [templates, entities, existing] = await Promise.all([
    tx.select().from(schema.obligationTemplate).where(eq(schema.obligationTemplate.isActive, true)),
    tx.select({ id: schema.entity.id, code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.isActive, true)),
    tx.select({ templateId: schema.obligationInstance.templateId, entityId: schema.obligationInstance.entityId, periodKey: schema.obligationInstance.periodKey }).from(schema.obligationInstance),
  ]);
  const have = new Set(existing.map((row) => `${row.templateId}|${row.entityId}|${row.periodKey}`));
  const entityCode = new Map(entities.map((row) => [row.id, row.code]));
  const appliesTo = (template: ObligationTemplateRow, entityId: string) => entityCode.has(entityId) && (!template.entityIds || template.entityIds.includes(entityId));

  // Days off per entity, read once for the whole window (and a month either side for shifting).
  const daysOff = new Map<string, Set<IsoDate>>();
  const daysOffOf = async (entityId: string) => {
    if (!daysOff.has(entityId)) daysOff.set(entityId, new Set((await getDaysOff(entityId, addDays(from, -45), addDays(to, 45), tx)).map((day) => day.date)));
    return daysOff.get(entityId)!;
  };

  const parties = new Map<string, string[]>();
  const candidates = async (rule: string, personId: string | null, entityId: string): Promise<string[]> => {
    if (rule === "none") return [];
    if (rule === "person") return personId ? [personId] : [];
    const key = `${rule}|${entityId}`;
    if (!parties.has(key)) {
      // The people whose job it is — never the owners' "*" — and the entity's own before the group's.
      const ids = rule.startsWith("role:") ? await listPeopleWithRole(rule.slice(5) as Role, { entityId }, tx) : await listPeopleHolding(rule.slice("permission:".length) as Exclude<Permission, "*">, { entityId }, { today, includeWildcard: false, executor: tx });
      const people = ids.length ? await tx.select({ id: schema.person.id, entityId: schema.person.primaryEntityId, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, ids)) : [];
      const active = people.filter((person) => person.status !== "offboarded").sort((a, b) => a.id.localeCompare(b.id));
      parties.set(key, [...active.filter((person) => person.entityId === entityId), ...active.filter((person) => person.entityId !== entityId)].map((person) => person.id));
    }
    return parties.get(key)!;
  };

  type Planned = { template: ObligationTemplateRow; entityId: string; periodKey: string; period: Period | null; nominal: IsoDate; title: string; subjectPersonId: string | null; source: { type: string; id: string } | null };
  const planned: Planned[] = [];

  for (const template of templates) {
    if (template.recurrence === "event") continue;
    for (const due of periodsDueBetween(template.recurrence as PeriodicRecurrence, template.dueRule, from, to)) {
      for (const entity of entities) {
        if (!appliesTo(template, entity.id) || have.has(`${template.id}|${entity.id}|${due.period.key}`)) continue;
        planned.push({ template, entityId: entity.id, periodKey: due.period.key, period: due.period, nominal: due.nominalDueDate, title: `${template.name} — ${periodLabel(due.period.key)} · ${entity.code}`, subjectPersonId: null, source: null });
      }
    }
  }

  // ── Pulled from HR events ─────────────────────────────────────────────────────────────────
  const eventTemplates = templates.filter((template) => template.recurrence === "event" && template.eventType);
  let cancelled = 0;
  if (eventTemplates.length) {
    const lookback = new Date(now.getTime() - EVENT_LOOKBACK_DAYS * 86_400_000);
    const since = eventTemplates.reduce((earliest, template) => (template.createdAt < earliest ? template.createdAt : earliest), lookback);
    const facts = await listLifecycleEventFacts({ createdSince: since, types: [...new Set(eventTemplates.map((template) => LIFECYCLE_TYPE[template.eventType as ObligationEventType]))] }, tx);

    const calledOff = facts.filter((fact) => fact.status === "cancelled").map((fact) => fact.id);
    if (calledOff.length) cancelled = await cancelForSources(tx, "lifecycle_event", calledOff);

    for (const template of eventTemplates) {
      const eventType = template.eventType as ObligationEventType;
      for (const fact of facts) {
        if (fact.status === "cancelled" || fact.type !== LIFECYCLE_TYPE[eventType] || !appliesTo(template, fact.entityId)) continue;
        if (fact.createdAt < template.createdAt && fact.createdAt < lookback) continue;
        // The day after a long absence ends is the day the person is back on the insurance list.
        const eventDate = eventType === "long_leave_return" ? (fact.until ? addDays(fact.until, 1) : null) : fact.effectiveDate;
        if (!eventDate || eventDate < addDays(today, -EVENT_LOOKBACK_DAYS)) continue;
        const periodKey = `event:${fact.id}`;
        if (have.has(`${template.id}|${fact.entityId}|${periodKey}`)) continue;
        // A return far in the future waits until it comes into the horizon.
        const nominal = nominalDueDate(template.dueRule, { eventDate });
        if (nominal > to) continue;
        planned.push({ template, entityId: fact.entityId, periodKey, period: null, nominal, title: `${template.name} — ${fact.personName} · ${entityCode.get(fact.entityId)}`, subjectPersonId: fact.personId, source: { type: "lifecycle_event", id: fact.id } });
      }
    }
  }

  // ── Writing ───────────────────────────────────────────────────────────────────────────────
  const told = new Map<string, { count: number; title: string }>();
  let unassigned = 0;
  for (const plan of planned) {
    const { template } = plan;
    // Nobody prepares the papers about themselves leaving: the subject is never the owner.
    const owner = (await candidates(template.ownerRule, template.ownerPersonId, plan.entityId)).find((id) => id !== plan.subjectPersonId) ?? null;
    const reviewer = (await candidates(template.reviewerRule, template.reviewerPersonId, plan.entityId)).find((id) => id !== owner && id !== plan.subjectPersonId) ?? null;
    const dueDate = shiftDueDate(plan.nominal, template.shift as Shift, await daysOffOf(plan.entityId));
    const [task] = await createTasks(tx, [{ kind: OBLIGATION_KIND, title: plan.title, assigneePersonId: owner, dueDate, entityId: plan.entityId, subjectPersonId: plan.subjectPersonId, context: { type: "obligation_template", id: template.id } }], options.actorId ?? null, { notify: false });
    await tx.insert(schema.obligationInstance).values({ taskId: task.id, templateId: template.id, entityId: plan.entityId, periodKey: plan.periodKey, periodStart: plan.period?.start ?? null, periodEnd: plan.period?.end ?? null, nominalDueDate: plan.nominal, sourceType: plan.source?.type ?? null, sourceId: plan.source?.id ?? null, reviewerPersonId: reviewer });
    if (!owner) unassigned++;
    else if (owner !== options.actorId) told.set(owner, { count: (told.get(owner)?.count ?? 0) + 1, title: told.get(owner)?.title ?? plan.title });
  }
  // One notice per person per run: a quarter's worth of returns is one event, not thirty.
  for (const [personId, { count, title }] of told) await notify({ recipients: [personId], kind: "ops.assigned", params: { count, title }, link: "/ops" }, tx);

  const autoCompleted = (await closeLockedTimesheetMonths(tx, templates)) + (await closePayrollMilestones(tx, templates));
  return { created: planned.length, fromEvents: planned.filter((plan) => plan.source).length, cancelled, autoCompleted, unassigned };
}

/** The event will not happen (a termination called off, a long leave cancelled): its open obligations are cancelled, finished ones stay as history. */
async function cancelForSources(tx: Executor, sourceType: string, sourceIds: string[]): Promise<number> {
  const open = await tx
    .select({ taskId: schema.obligationInstance.taskId })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .where(and(eq(schema.obligationInstance.sourceType, sourceType), inArray(schema.obligationInstance.sourceId, sourceIds), inArray(schema.task.status, [...OPEN]), isNull(schema.task.deletedAt)));
  if (open.length === 0) return 0;
  await tx.update(schema.task).set({ status: "cancelled", updatedAt: new Date() }).where(inArray(schema.task.id, open.map((row) => row.taskId)));
  return open.length;
}

/**
 * FR-OPS-10: the monthly payroll calendar closes itself. "Trình bảng lương" is done when the
 * month's run has been proposed, "ký duyệt" when the CEO has signed it, "chi lương" when it is
 * paid. A run that goes further closes the earlier ones too, so a month approved before anyone
 * looked at the tracker still ticks all its boxes.
 */
async function closePayrollMilestones(tx: Executor, templates: ObligationTemplateRow[]): Promise<number> {
  const wanted = PAYROLL_MILESTONES.map((milestone) => ({ ...milestone, template: templates.find((row) => row.code === milestone.code) })).filter((milestone) => milestone.template);
  if (wanted.length === 0) return 0;

  const open = await tx
    .select({ instance: schema.obligationInstance })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .where(and(inArray(schema.obligationInstance.templateId, wanted.map((milestone) => milestone.template!.id)), inArray(schema.task.status, [...OPEN]), isNull(schema.task.deletedAt)));
  if (open.length === 0) return 0;

  // One read for every month in question; payroll answers with statuses and dates only.
  const months = [...new Set(open.map((row) => row.instance.periodKey))].filter((key) => /^\d{4}-\d{2}$/.test(key));
  const milestones = months.length === 0 ? [] : await listRunMilestones({ entityIds: [...new Set(open.map((row) => row.instance.entityId))], months }, tx);
  const byKey = new Map(milestones.map((milestone) => [`${milestone.entityId}|${milestone.month}`, milestone]));

  let closed = 0;
  for (const { instance } of open) {
    const wants = wanted.find((milestone) => milestone.template!.id === instance.templateId);
    const run = byKey.get(`${instance.entityId}|${instance.periodKey}`);
    if (!wants || !run || !hasReached(run, wants.reached)) continue;
    await tx.update(schema.task).set({ status: "done", completedAt: new Date(), completedByPersonId: null, updatedAt: new Date() }).where(eq(schema.task.id, instance.taskId));
    await tx.update(schema.obligationInstance).set({ note: `system:payroll_${wants.reached}`, completedLate: false, updatedAt: new Date() }).where(eq(schema.obligationInstance.id, instance.id));
    closed++;
  }
  return closed;
}

/** FR-OPS-10, lite: "lock the timesheet" is done when attendance says the entity's month is locked. */
async function closeLockedTimesheetMonths(tx: Executor, templates: ObligationTemplateRow[]): Promise<number> {
  const template = templates.find((row) => row.code === TIMESHEET_LOCK_CODE);
  if (!template) return 0;
  const open = await tx
    .select({ instance: schema.obligationInstance, dueDate: schema.task.dueDate })
    .from(schema.obligationInstance)
    .innerJoin(schema.task, eq(schema.task.id, schema.obligationInstance.taskId))
    .where(and(eq(schema.obligationInstance.templateId, template.id), inArray(schema.task.status, [...OPEN]), isNull(schema.task.deletedAt)));
  let closed = 0;
  for (const { instance } of open) {
    if (!/^\d{4}-\d{2}$/.test(instance.periodKey) || !(await isPeriodLocked(instance.entityId, instance.periodKey, tx))) continue;
    await tx.update(schema.task).set({ status: "done", completedAt: new Date(), completedByPersonId: null, updatedAt: new Date() }).where(eq(schema.task.id, instance.taskId));
    // When it was locked is on the timesheet period itself; "late or not" is not guessed here.
    await tx.update(schema.obligationInstance).set({ note: "system:timesheet_locked", completedLate: false, updatedAt: new Date() }).where(eq(schema.obligationInstance.id, instance.id));
    closed++;
  }
  return closed;
}
