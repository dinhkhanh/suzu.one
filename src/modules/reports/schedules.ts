// Scheduled reports (FR-RPT-05): the use-cases, and the job that delivers them.
//
// The one rule that matters is in `runSchedule`: **a report is built once per recipient, as that
// recipient**. It is never built once by the creator and copied. `buildReportFor` answers null for
// somebody who may not read the report, and that person is recorded as `not_permitted` and sent
// nothing — so a schedule made in January by an HR admin does not keep posting headcount to a
// person whose role was taken away in March.
//
// Delivery is the existing email adapter and nothing new: with no `RESEND_API_KEY` the outbox
// keeps the message and marks it `skipped`, which is the local behaviour and is honest about it.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { queueRawEmail } from "@/modules/platform/notifications/service";
import { can } from "@/modules/platform/rbac/policy";
import { loadGrants } from "@/modules/platform/rbac/service";
import { buildReportFor, findReport, isSchedulable, type Locale, type ReportViewer, reportToText } from "./catalogue";
import { clampDayOfMonth, clampDayOfWeek, nextRunAfter, nextRunOnOrAfter, periodFor } from "./engine/cadence";
import { canEditSchedule, type ScheduleViewer } from "./policy";

export type ScheduleRow = typeof schema.reportSchedule.$inferSelect;
export type ScheduleRunRow = typeof schema.reportScheduleRun.$inferSelect;
export type RecipientView = { personId: string; fullName: string; email: string | null };
export type ScheduleView = ScheduleRow & { recipients: RecipientView[]; createdByName: string | null; lastRun: ScheduleRunRow | null };

export type ScheduleInput = {
  reportKey: string;
  name: string;
  parameters: Record<string, unknown>;
  cadence: "daily" | "weekly" | "monthly";
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  locale: Locale;
  recipientPersonIds: string[];
};

const live = isNull(schema.reportSchedule.deletedAt);

async function recipientsOf(scheduleIds: readonly string[]): Promise<Map<string, RecipientView[]>> {
  if (scheduleIds.length === 0) return new Map();
  const rows = await db()
    .select({ scheduleId: schema.reportScheduleRecipient.scheduleId, personId: schema.person.id, fullName: schema.person.fullName, email: schema.person.workEmail })
    .from(schema.reportScheduleRecipient)
    .innerJoin(schema.person, eq(schema.person.id, schema.reportScheduleRecipient.personId))
    .where(inArray(schema.reportScheduleRecipient.scheduleId, [...scheduleIds]))
    .orderBy(asc(schema.person.searchName));
  const byId = new Map<string, RecipientView[]>();
  for (const row of rows) {
    const list = byId.get(row.scheduleId) ?? [];
    list.push({ personId: row.personId, fullName: row.fullName, email: row.email });
    byId.set(row.scheduleId, list);
  }
  return byId;
}

/** The schedules the viewer may see: their own, plus every one for `org:manage` holders. */
export async function listSchedules(viewer: ScheduleViewer): Promise<ScheduleView[]> {
  return loadScheduleViews(viewer);
}

/** One schedule, as `listSchedules` would show it; undefined when the viewer may not see it. */
export async function getScheduleView(viewer: ScheduleViewer, id: string): Promise<ScheduleView | undefined> {
  const [view] = await loadScheduleViews(viewer, id);
  return view;
}

async function loadScheduleViews(viewer: ScheduleViewer, id?: string): Promise<ScheduleView[]> {
  const rows = await db()
    .select({ schedule: schema.reportSchedule, createdByName: schema.person.fullName })
    .from(schema.reportSchedule)
    .leftJoin(schema.person, eq(schema.person.id, schema.reportSchedule.createdByPersonId))
    .where(
      and(
        live,
        id ? eq(schema.reportSchedule.id, id) : undefined,
        // canEditSchedule in SQL; it is still applied below.
        can(viewer.principal, "org:manage") ? undefined : viewer.personId ? eq(schema.reportSchedule.createdByPersonId, viewer.personId) : sql`false`,
      ),
    )
    .orderBy(asc(schema.reportSchedule.nextRunOn), asc(schema.reportSchedule.name));
  const mine = rows.filter((row) => canEditSchedule(viewer, row.schedule));
  const ids = mine.map((row) => row.schedule.id);
  const [recipients, runs] = await Promise.all([
    recipientsOf(ids),
    // Only each schedule's latest run.
    ids.length
      ? db()
          .selectDistinctOn([schema.reportScheduleRun.scheduleId])
          .from(schema.reportScheduleRun)
          .where(inArray(schema.reportScheduleRun.scheduleId, ids))
          .orderBy(schema.reportScheduleRun.scheduleId, desc(schema.reportScheduleRun.runOn), desc(schema.reportScheduleRun.createdAt))
      : [],
  ]);
  const lastRuns = new Map(runs.map((run) => [run.scheduleId, run]));
  return mine.map((row) => ({ ...row.schedule, createdByName: row.createdByName, recipients: recipients.get(row.schedule.id) ?? [], lastRun: lastRuns.get(row.schedule.id) ?? null }));
}

export async function findSchedule(id: string): Promise<ScheduleRow | undefined> {
  const [row] = await db().select().from(schema.reportSchedule).where(and(eq(schema.reportSchedule.id, id), live)).limit(1);
  return row;
}

function normalise(input: ScheduleInput, today: IsoDate) {
  const shape = {
    cadence: input.cadence,
    dayOfWeek: input.cadence === "weekly" ? clampDayOfWeek(input.dayOfWeek) : null,
    dayOfMonth: input.cadence === "monthly" ? clampDayOfMonth(input.dayOfMonth) : null,
  };
  return { ...shape, nextRunOn: nextRunOnOrAfter(shape, today) };
}

/**
 * Creates a schedule. The caller has already checked that this person may read the report today —
 * `createScheduleAction` does it through the catalogue — and it is checked again here, because a
 * use-case that trusts its caller is a use-case waiting to be called from somewhere else.
 */
export async function createSchedule(user: ReportViewer, input: ScheduleInput, today: IsoDate = todayInVietnam()): Promise<ScheduleRow> {
  const definition = findReport(input.reportKey);
  if (!definition || !isSchedulable(input.reportKey)) throw new ActionError("unknown_report");
  if (!(await definition.canSee(user))) throw new ActionError("forbidden");
  const shape = normalise(input, today);
  return db().transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.reportSchedule)
      .values({ reportKey: input.reportKey, name: input.name, parameters: input.parameters, locale: input.locale, createdByPersonId: user.person.id, ...shape })
      .returning();
    await writeRecipients(tx, row.id, input.recipientPersonIds);
    return row;
  });
}

export async function updateSchedule(id: string, input: ScheduleInput, today: IsoDate = todayInVietnam()): Promise<{ before: ScheduleRow; after: ScheduleRow }> {
  const before = await findSchedule(id);
  if (!before) throw new ActionError("not_found");
  const shape = normalise(input, today);
  return db().transaction(async (tx) => {
    const [after] = await tx
      .update(schema.reportSchedule)
      .set({ name: input.name, parameters: input.parameters, locale: input.locale, updatedAt: new Date(), ...shape })
      .where(eq(schema.reportSchedule.id, id))
      .returning();
    await writeRecipients(tx, id, input.recipientPersonIds);
    return { before, after };
  });
}

async function writeRecipients(tx: Tx, scheduleId: string, personIds: readonly string[]): Promise<void> {
  await tx.delete(schema.reportScheduleRecipient).where(eq(schema.reportScheduleRecipient.scheduleId, scheduleId));
  const unique = [...new Set(personIds)];
  if (unique.length) await tx.insert(schema.reportScheduleRecipient).values(unique.map((personId) => ({ scheduleId, personId })));
}

export async function setScheduleActive(id: string, isActive: boolean, today: IsoDate = todayInVietnam()): Promise<{ before: ScheduleRow; after: ScheduleRow }> {
  const before = await findSchedule(id);
  if (!before) throw new ActionError("not_found");
  // Resuming a paused schedule does not fire the runs it slept through: its next date is from today.
  const nextRunOn = isActive ? nextRunOnOrAfter({ cadence: before.cadence, dayOfWeek: before.dayOfWeek, dayOfMonth: before.dayOfMonth }, today) : before.nextRunOn;
  const [after] = await db().update(schema.reportSchedule).set({ isActive, nextRunOn, updatedAt: new Date() }).where(eq(schema.reportSchedule.id, id)).returning();
  return { before, after };
}

export async function deleteSchedule(id: string): Promise<ScheduleRow> {
  const before = await findSchedule(id);
  if (!before) throw new ActionError("not_found");
  const [after] = await db().update(schema.reportSchedule).set({ deletedAt: new Date(), isActive: false }).where(eq(schema.reportSchedule.id, id)).returning();
  return after;
}

// ── Running ─────────────────────────────────────────────────────────────────────────────────

export type RecipientOutcome = { personId: string; outcome: "delivered" | "not_permitted" | "no_email" | "failed"; rows: number };

/** The recipient as the catalogue wants them: their own person row and their own grants. */
async function viewerFor(personId: string): Promise<ReportViewer | null> {
  const [person] = await db().select().from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!person || person.status === "offboarded" || person.status === "suspended") return null;
  return { person, principal: { personId: person.id, workforceType: person.workforceType, grants: await loadGrants(person.id) } };
}

/**
 * Runs one schedule for the day `runOn`, building the report **separately for each recipient with
 * that recipient's own permissions**, and records what each of them got.
 */
export async function runSchedule(schedule: ScheduleRow, runOn: IsoDate): Promise<ScheduleRunRow> {
  const period = periodFor(schedule.cadence, runOn);
  const definition = isSchedulable(schedule.reportKey) ? findReport(schedule.reportKey) : undefined;
  const recipients = await db().select({ personId: schema.reportScheduleRecipient.personId }).from(schema.reportScheduleRecipient).where(eq(schema.reportScheduleRecipient.scheduleId, schedule.id));
  const base = env().BETTER_AUTH_URL.replace(/\/$/, "");
  const outcomes: RecipientOutcome[] = [];

  for (const { personId } of recipients) {
    try {
      const viewer = await viewerFor(personId);
      const table = viewer && definition ? await buildReportFor(viewer, schedule.reportKey, schedule.parameters, period, schedule.locale as Locale) : null;
      if (!viewer || !table) {
        outcomes.push({ personId, outcome: "not_permitted", rows: 0 });
        continue;
      }
      if (!viewer.person.workEmail) {
        outcomes.push({ personId, outcome: "no_email", rows: table.rows.length });
        continue;
      }
      const parsed = definition!.parameters.safeParse(schedule.parameters ?? {});
      const link = `${base}${parsed.success ? definition!.href(parsed.data) : "/reports"}`;
      await queueRawEmail(viewer.person.workEmail, `${schedule.name} — ${period.from} → ${period.to}`, reportToText(table, period, link));
      outcomes.push({ personId, outcome: "delivered", rows: table.rows.length });
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "report_schedule.recipient_failed", scheduleId: schedule.id, personId, message: error instanceof Error ? error.message : String(error) }));
      outcomes.push({ personId, outcome: "failed", rows: 0 });
    }
  }

  const delivered = outcomes.filter((outcome) => outcome.outcome === "delivered").length;
  const withheld = outcomes.filter((outcome) => outcome.outcome === "not_permitted").length;
  const failed = outcomes.some((outcome) => outcome.outcome === "failed");
  const status = failed && delivered === 0 ? "failed" : failed || withheld > 0 || outcomes.some((outcome) => outcome.outcome === "no_email") ? "partial" : "succeeded";

  return db().transaction(async (tx) => {
    const [run] = await tx
      .insert(schema.reportScheduleRun)
      .values({ scheduleId: schedule.id, runOn, periodFrom: period.from, periodTo: period.to, status, delivered, withheld, outcomes, error: definition ? null : `unknown report: ${schedule.reportKey}` })
      .returning();
    await tx
      .update(schema.reportSchedule)
      .set({ lastRunOn: runOn, nextRunOn: nextRunAfter({ cadence: schedule.cadence, dayOfWeek: schedule.dayOfWeek, dayOfMonth: schedule.dayOfMonth }, runOn), updatedAt: new Date() })
      .where(eq(schema.reportSchedule.id, schedule.id));
    return run;
  });
}

/** The job: every active schedule due on or before today, each run once. */
export async function runDueSchedules(today: IsoDate = todayInVietnam()): Promise<{ schedules: number; delivered: number; withheld: number }> {
  const due = await db()
    .select()
    .from(schema.reportSchedule)
    .where(and(live, eq(schema.reportSchedule.isActive, true), lte(schema.reportSchedule.nextRunOn, today), sql`${schema.reportSchedule.lastRunOn} is distinct from ${today}::date`))
    .orderBy(asc(schema.reportSchedule.nextRunOn))
    .limit(200);
  const tally = { schedules: 0, delivered: 0, withheld: 0 };
  for (const schedule of due) {
    const run = await runSchedule(schedule, today);
    tally.schedules++;
    tally.delivered += run.delivered;
    tally.withheld += run.withheld;
  }
  return tally;
}
