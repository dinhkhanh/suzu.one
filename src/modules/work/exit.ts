// Exit and transfer handover (FR-PJM-45). Pulled, not pushed: a job reads termination and transfer
// events from core HR and opens a handover — a step in the person's offboarding checklist (a task
// of the engine, kind "checklist", on the lifecycle event, assigned to the line manager). What the
// person still owns is computed live every time; the step cannot be completed while anything is
// left (exit-guard.ts), and the handover page reassigns in bulk, with one note, as `exit` hand-offs.
import "server-only";
import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listLifecycleEventFacts } from "../core-hr/service";
import { notify } from "../platform/notifications/service";
import { createTask, setTaskStatus } from "../platform/tasks-engine/service";
import { invalidateWorkDirectory } from "./directory";
import { HANDOVER_EVENT_TYPES, type OwnedItem, type OwnershipKind, ownershipSummary, reassignProblem } from "./engine/exit";
import { normalizeNote, type Note, noteIsEmpty } from "./engine/handoff";
import type { ExitHandoverFacts } from "./policy";
import { taskKey, updateWorkTaskIn, WORK_KIND } from "./tasks";
import { invalidateWorkClients } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type ExitHandoverRow = typeof schema.workExitHandover.$inferSelect;

/** An event older than this when the job first sees it is history (an import), not a handover to run. */
export const HANDOVER_LOOKBACK_DAYS = 60;
/** The checklist step's title: data, like every checklist step HR writes, in the company's language. */
export const HANDOVER_STEP_TITLE = "Bàn giao công việc";
export const handoverLink = (handoverId: string) => `/work/handover/${handoverId}`;

const OPEN_TASK = ["todo", "in_progress"] as const;
const OPEN_PROJECT = notInArray(schema.workProject.status, ["done", "archived"]);

// ── What the person owns, live ──────────────────────────────────────────────────────────────

/** Weeks of time looked back on for a handover: two months is more than any approval takes. */
export const TIME_WEEKS_BACK = 8;

// The daily module keeps time weeks and builds on work: read through its service, loaded when
// first needed so the two never import each other at load time.
const dailyService = () => import("../daily/service");

/**
 * Weeks with time logged that the person still has to submit — only where a team of theirs
 * approves timesheets (elsewhere a week is never submitted, so it never closes). A week is closed
 * by submitting it, never handed to anyone.
 */
async function openTimeWeeks(personId: string, today: IsoDate): Promise<OwnedItem[]> {
  const daily = await dailyService();
  const thisWeek = daily.weekStartOf(today);
  const weeks = Array.from({ length: TIME_WEEKS_BACK }, (_, index) => addDays(thisWeek, -7 * index));
  const logged = (await daily.loggedMinutesByPersonWeek([personId], weeks)).get(personId);
  const withTime = weeks.filter((week) => (logged?.get(week)?.minutes ?? 0) > 0);
  const items: OwnedItem[] = [];
  for (const week of withTime.sort()) {
    const view = await daily.getMyTimeWeek(personId, week, today);
    if (view?.approvalRequired && (view.status === "open" || view.status === "returned")) items.push({ kind: "time_week", id: view.week?.id ?? week, label: week, context: null });
  }
  return items;
}

/**
 * Everything in work management that still hangs on the person, and the weeks of time they have
 * not submitted (the daily module's, read through its service).
 */
export async function listOwnership(personId: string, executor: Executor = db(), options: { today?: IsoDate; /** Inside a transaction the daily module's reads (own connection) are left out: time weeks are never reassigned anyway. */ timeWeeks?: boolean } = {}): Promise<OwnedItem[]> {
  const workTask = and(eq(schema.task.kind, WORK_KIND), isNull(schema.task.deletedAt), inArray(schema.task.status, [...OPEN_TASK]));
  const [tasks, reviews, projectsLed, accountRoles, clients, recurrences, forms, automations, teams] = await Promise.all([
    executor
      .select({ id: schema.task.id, title: schema.task.title, number: schema.workTask.number, teamKey: schema.workTeam.key, context: sql<string>`coalesce(${schema.workProject.name}, ${schema.workTeam.name})` })
      .from(schema.task)
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
      .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
      .where(and(workTask, eq(schema.task.assigneePersonId, personId)))
      .orderBy(asc(schema.task.dueDate), asc(schema.workTask.number)),
    executor
      .select({ id: schema.task.id, title: schema.task.title, number: schema.workTask.number, teamKey: schema.workTeam.key, context: sql<string>`coalesce(${schema.workProject.name}, ${schema.workTeam.name})` })
      .from(schema.task)
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
      .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
      .where(and(workTask, eq(schema.workTask.reviewerPersonId, personId)))
      .orderBy(asc(schema.workTask.number)),
    executor
      .selectDistinct({ id: schema.workProject.id, name: schema.workProject.name, teamName: schema.workTeam.name })
      .from(schema.workProject)
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId))
      .leftJoin(schema.workProjectMember, and(eq(schema.workProjectMember.projectId, schema.workProject.id), eq(schema.workProjectMember.personId, personId), eq(schema.workProjectMember.role, "lead")))
      .where(and(OPEN_PROJECT, or(eq(schema.workProject.leadPersonId, personId), sql`${schema.workProjectMember.id} is not null`))),
    executor
      .select({ id: schema.workProject.id, name: schema.workProject.name, teamName: schema.workTeam.name })
      .from(schema.workProjectMember)
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.workProjectMember.projectId))
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId))
      .where(and(OPEN_PROJECT, eq(schema.workProjectMember.personId, personId), eq(schema.workProjectMember.role, "account_manager"))),
    executor.select({ id: schema.workClient.id, name: schema.workClient.name, code: schema.workClient.code }).from(schema.workClient).where(and(eq(schema.workClient.accountManagerPersonId, personId), eq(schema.workClient.isActive, true))),
    executor
      .select({ id: schema.workRecurrence.id, title: schema.workRecurrence.title, context: sql<string>`coalesce(${schema.workProject.name}, ${schema.workTeam.name})` })
      .from(schema.workRecurrence)
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workRecurrence.teamId))
      .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workRecurrence.projectId))
      .where(and(eq(schema.workRecurrence.isActive, true), sql`${schema.workRecurrence.draft}->>'assigneePersonId' = ${personId}`)),
    executor.select({ id: schema.workIntakeForm.id, name: schema.workIntakeForm.name, teamName: schema.workTeam.name }).from(schema.workIntakeForm).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workIntakeForm.teamId)).where(and(eq(schema.workIntakeForm.isActive, true), eq(schema.workIntakeForm.createdByPersonId, personId))),
    executor.select({ id: schema.workAutomation.id, name: schema.workAutomation.name, teamName: schema.workTeam.name }).from(schema.workAutomation).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workAutomation.teamId)).where(and(eq(schema.workAutomation.isActive, true), eq(schema.workAutomation.createdByPersonId, personId))),
    executor
      .select({ id: schema.workTeam.id, name: schema.workTeam.name })
      .from(schema.workTeamMember)
      .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTeamMember.teamId))
      .where(and(eq(schema.workTeamMember.personId, personId), eq(schema.workTeamMember.role, "lead"), eq(schema.workTeam.isActive, true))),
  ]);
  const timeWeeks = options.timeWeeks === false ? [] : await openTimeWeeks(personId, options.today ?? todayInVietnam());
  const item = (kind: OwnershipKind, id: string, label: string, context: string | null): OwnedItem => ({ kind, id, label, context });
  return [
    ...tasks.map((row) => item("task", row.id, `${taskKey(row.teamKey, row.number)} ${row.title}`, row.context)),
    ...reviews.map((row) => item("review", row.id, `${taskKey(row.teamKey, row.number)} ${row.title}`, row.context)),
    ...projectsLed.map((row) => item("project_lead", row.id, row.name, row.teamName)),
    ...accountRoles.map((row) => item("account_manager", row.id, row.name, row.teamName)),
    ...clients.map((row) => item("client_account", row.id, `${row.code} ${row.name}`, null)),
    ...recurrences.map((row) => item("recurrence", row.id, row.title, row.context)),
    ...forms.map((row) => item("intake_form", row.id, row.name, row.teamName)),
    ...automations.map((row) => item("automation", row.id, row.name, row.teamName)),
    ...teams.map((row) => item("team_lead", row.id, row.name, null)),
    ...timeWeeks,
  ];
}

// ── Opening handovers from lifecycle events (the job) ───────────────────────────────────────

async function teamLeadsOf(executor: Executor, personId: string): Promise<string[]> {
  const rows = await executor
    .selectDistinct({ personId: schema.workTeamMember.personId })
    .from(schema.workTeamMember)
    .where(and(eq(schema.workTeamMember.role, "lead"), inArray(schema.workTeamMember.teamId, executor.select({ teamId: schema.workTeamMember.teamId }).from(schema.workTeamMember).where(eq(schema.workTeamMember.personId, personId)))));
  return rows.map((row) => row.personId).filter((id) => id !== personId);
}

/**
 * Every termination or transfer gets its handover once (the lifecycle event id is unique). A
 * cancelled event cancels an open handover and its step. A step that was completed — the guard
 * let it through, so nothing was owned — marks its handover done.
 */
export async function syncExitHandovers(now: Date, today: IsoDate): Promise<{ opened: number; cancelled: number; done: number }> {
  const since = new Date(now.getTime() - HANDOVER_LOOKBACK_DAYS * 86_400_000);
  const facts = await listLifecycleEventFacts({ createdSince: since, types: HANDOVER_EVENT_TYPES });
  const result = { opened: 0, cancelled: 0, done: 0 };
  const known = facts.length ? await db().select().from(schema.workExitHandover).where(inArray(schema.workExitHandover.lifecycleEventId, facts.map((fact) => fact.id))) : [];
  for (const fact of facts) {
    const existing = known.find((row) => row.lifecycleEventId === fact.id);
    if (fact.status === "cancelled") {
      if (existing?.status === "open") {
        await db().transaction(async (tx) => {
          await tx.update(schema.workExitHandover).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.workExitHandover.id, existing.id));
          if (existing.taskId) await tx.update(schema.task).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(schema.task.id, existing.taskId), inArray(schema.task.status, [...OPEN_TASK])));
        });
        result.cancelled += 1;
      }
      continue;
    }
    // An old last day that is long past is history, not a handover to run now.
    if (existing || fact.effectiveDate < addDays(today, -HANDOVER_LOOKBACK_DAYS)) continue;
    const ownedCount = (await listOwnership(fact.personId)).length;
    const opened = await db().transaction(async (tx) => {
      const [person] = await tx.select({ managerId: schema.person.managerId }).from(schema.person).where(eq(schema.person.id, fact.personId)).limit(1);
      const [handover] = await tx.insert(schema.workExitHandover).values({ personId: fact.personId, lifecycleEventId: fact.id, reason: fact.type, lastDay: fact.effectiveDate }).onConflictDoNothing().returning();
      if (!handover) return false;
      const step = await createTask(
        tx,
        { kind: "checklist", title: HANDOVER_STEP_TITLE, linkUrl: handoverLink(handover.id), assigneePersonId: person?.managerId ?? null, dueDate: fact.effectiveDate, entityId: fact.entityId, context: { type: "lifecycle_event", id: fact.id }, subjectPersonId: fact.personId, sortOrder: -1 },
        null,
        { notify: false },
      );
      await tx.update(schema.workExitHandover).set({ taskId: step.id }).where(eq(schema.workExitHandover.id, handover.id));
      const recipients = [person?.managerId, ...(await teamLeadsOf(tx, fact.personId))].filter((id): id is string => !!id && id !== fact.personId);
      await notify({ recipients, kind: "tasks.exit_handover", params: { person: fact.personName, count: ownedCount }, link: handoverLink(handover.id) }, tx);
      return true;
    });
    if (opened) result.opened += 1;
  }
  // Steps completed since the last run (the guard allowed it): their handovers are done.
  const finished = await db()
    .update(schema.workExitHandover)
    .set({ status: "done", doneAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.workExitHandover.status, "open"), inArray(schema.workExitHandover.taskId, db().select({ id: schema.task.id }).from(schema.task).where(eq(schema.task.status, "done")))))
    .returning({ id: schema.workExitHandover.id });
  result.done = finished.length;
  return result;
}

// ── Reading one handover ────────────────────────────────────────────────────────────────────

export type ExitHandoverView = ExitHandoverRow & { personName: string; managerId: string | null; entityId: string | null; teamIds: string[]; step: { id: string; status: string; assigneeName: string | null } | null; owned: OwnedItem[]; summary: ReturnType<typeof ownershipSummary>; facts: ExitHandoverFacts };

export async function findExitHandover(handoverId: string, executor: Executor = db()): Promise<ExitHandoverRow | undefined> {
  const [row] = await executor.select().from(schema.workExitHandover).where(eq(schema.workExitHandover.id, handoverId)).limit(1);
  return row;
}

/** What the policy needs about the person: their manager, entity and work teams. */
export async function exitHandoverFacts(handover: Pick<ExitHandoverRow, "personId">, executor: Executor = db()): Promise<ExitHandoverFacts> {
  const [[person], teams] = await Promise.all([
    executor.select({ managerId: schema.person.managerId, entityId: schema.person.primaryEntityId }).from(schema.person).where(eq(schema.person.id, handover.personId)).limit(1),
    executor.select({ teamId: schema.workTeamMember.teamId }).from(schema.workTeamMember).where(eq(schema.workTeamMember.personId, handover.personId)),
  ]);
  return { personId: handover.personId, managerId: person?.managerId ?? null, entityId: person?.entityId ?? null, teamIds: teams.map((row) => row.teamId) };
}

export async function getExitHandover(handoverId: string): Promise<ExitHandoverView | undefined> {
  const handover = await findExitHandover(handoverId);
  if (!handover) return undefined;
  const assignee = schema.person;
  const [facts, owned, [person], [step]] = await Promise.all([
    exitHandoverFacts(handover),
    listOwnership(handover.personId),
    db().select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, handover.personId)).limit(1),
    handover.taskId ? db().select({ id: schema.task.id, status: schema.task.status, assigneeName: assignee.fullName }).from(schema.task).leftJoin(assignee, eq(assignee.id, schema.task.assigneePersonId)).where(eq(schema.task.id, handover.taskId)).limit(1) : [],
  ]);
  return { ...handover, personName: person?.name ?? "", managerId: facts.managerId, entityId: facts.entityId, teamIds: [...facts.teamIds], step: step ?? null, owned, summary: ownershipSummary(owned), facts };
}

/** Open handovers a person runs as line manager or team lead — for "My work". */
export async function listExitHandoversFor(personId: string): Promise<{ id: string; personName: string; reason: string; lastDay: string | null }[]> {
  const ledTeams = db().select({ teamId: schema.workTeamMember.teamId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.personId, personId), eq(schema.workTeamMember.role, "lead")));
  const inLedTeam = db().select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(inArray(schema.workTeamMember.teamId, ledTeams));
  const rows = await db()
    .select({ id: schema.workExitHandover.id, personName: schema.person.fullName, reason: schema.workExitHandover.reason, lastDay: schema.workExitHandover.lastDay })
    .from(schema.workExitHandover)
    .innerJoin(schema.person, eq(schema.person.id, schema.workExitHandover.personId))
    .where(and(eq(schema.workExitHandover.status, "open"), or(eq(schema.person.managerId, personId), inArray(schema.workExitHandover.personId, inLedTeam))))
    .orderBy(asc(schema.workExitHandover.lastDay));
  return rows;
}

// ── Reassigning ─────────────────────────────────────────────────────────────────────────────

export type ReassignResult = { moved: { kind: OwnershipKind; id: string; label: string }[]; remaining: number };

/**
 * Hands the chosen items to one person, with one note (FR-PJM-43): each becomes an `exit` hand-off
 * — on the task for tasks and review duties, on its own for a project, a client or a team role.
 * Items the person no longer owns are skipped (someone else was quicker). The new owner of a task
 * hears as for any task handed to them.
 */
export async function reassignOwnership(handoverId: string, input: { items: { kind: OwnershipKind; id: string }[]; toPersonId: string; note: Note }, actor: { personId: string; fullName: string }): Promise<ReassignResult> {
  const result = await db().transaction(async (tx) => {
    const handover = await findExitHandover(handoverId, tx);
    if (!handover || handover.status !== "open") throw new ActionError("exit_handover_closed");
    const problem = reassignProblem({ leaverId: handover.personId, toPersonId: input.toPersonId, items: input.items });
    if (problem) throw new ActionError(problem);
    const note = normalizeNote(input.note);
    if (noteIsEmpty(note)) throw new ActionError("handoff_note_required");
    const [to] = await tx.select({ id: schema.person.id, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, input.toPersonId)).limit(1);
    if (!to || to.status === "offboarded") throw new ActionError("person_not_found");

    const owned = await listOwnership(handover.personId, tx, { timeWeeks: false });
    const chosen = owned.filter((item) => input.items.some((wanted) => wanted.kind === item.kind && wanted.id === item.id));
    const leaver = handover.personId;
    const sourceRef = { lifecycleEventId: handover.lifecycleEventId, handoverId: handover.id };
    const record = (values: { taskId?: string | null; clientId?: string | null; ref?: Record<string, string> }) =>
      tx.insert(schema.workHandoff).values({ taskId: values.taskId ?? null, clientId: values.clientId ?? null, kind: "exit", fromPersonId: leaver, toPersonId: to.id, note, status: "recorded", sourceRef: { ...sourceRef, ...values.ref }, createdByPersonId: actor.personId });
    let directory = false;
    let clients = false;
    for (const item of chosen) {
      switch (item.kind) {
        case "task":
          await updateWorkTaskIn(tx, item.id, { assigneePersonId: to.id }, actor.personId, { handoff: "system" });
          await record({ taskId: item.id });
          break;
        case "review":
          await updateWorkTaskIn(tx, item.id, { reviewerPersonId: to.id }, actor.personId, { handoff: "system", quiet: true });
          await record({ taskId: item.id, ref: { duty: "review" } });
          break;
        case "project_lead":
          await tx.update(schema.workProject).set({ leadPersonId: to.id, updatedAt: new Date() }).where(and(eq(schema.workProject.id, item.id), eq(schema.workProject.leadPersonId, leaver)));
          await tx.update(schema.workProjectMember).set({ role: "member" }).where(and(eq(schema.workProjectMember.projectId, item.id), eq(schema.workProjectMember.personId, leaver), eq(schema.workProjectMember.role, "lead")));
          await tx.insert(schema.workProjectMember).values({ projectId: item.id, personId: to.id, role: "lead" }).onConflictDoUpdate({ target: [schema.workProjectMember.projectId, schema.workProjectMember.personId], set: { role: "lead" } });
          await record({ ref: { projectId: item.id, duty: "project_lead" } });
          directory = true;
          break;
        case "account_manager": {
          const [current] = await tx.select({ role: schema.workProjectMember.role }).from(schema.workProjectMember).where(and(eq(schema.workProjectMember.projectId, item.id), eq(schema.workProjectMember.personId, to.id))).limit(1);
          // A project's lead is not also its account manager (FR-PJM-14).
          if (current?.role === "lead") throw new ActionError("account_manager_is_lead", { project: item.label });
          await tx.update(schema.workProjectMember).set({ role: "member" }).where(and(eq(schema.workProjectMember.projectId, item.id), eq(schema.workProjectMember.personId, leaver), eq(schema.workProjectMember.role, "account_manager")));
          await tx.insert(schema.workProjectMember).values({ projectId: item.id, personId: to.id, role: "account_manager" }).onConflictDoUpdate({ target: [schema.workProjectMember.projectId, schema.workProjectMember.personId], set: { role: "account_manager" } });
          await record({ ref: { projectId: item.id, duty: "account_manager" } });
          break;
        }
        case "client_account":
          await tx.update(schema.workClient).set({ accountManagerPersonId: to.id, updatedAt: new Date() }).where(and(eq(schema.workClient.id, item.id), eq(schema.workClient.accountManagerPersonId, leaver)));
          await record({ clientId: item.id });
          clients = true;
          break;
        case "recurrence":
          await tx.update(schema.workRecurrence).set({ draft: sql`jsonb_set(${schema.workRecurrence.draft}, '{assigneePersonId}', to_jsonb(${to.id}::text))`, updatedAt: new Date() }).where(eq(schema.workRecurrence.id, item.id));
          await record({ ref: { recurrenceId: item.id } });
          break;
        case "intake_form":
          await tx.update(schema.workIntakeForm).set({ createdByPersonId: to.id, updatedAt: new Date() }).where(eq(schema.workIntakeForm.id, item.id));
          await record({ ref: { intakeFormId: item.id } });
          break;
        case "automation":
          await tx.update(schema.workAutomation).set({ createdByPersonId: to.id, updatedAt: new Date() }).where(eq(schema.workAutomation.id, item.id));
          await record({ ref: { automationId: item.id } });
          break;
        case "team_lead":
          await tx.insert(schema.workTeamMember).values({ teamId: item.id, personId: to.id, role: "lead" }).onConflictDoUpdate({ target: [schema.workTeamMember.teamId, schema.workTeamMember.personId], set: { role: "lead" } });
          await tx.update(schema.workTeamMember).set({ role: "member" }).where(and(eq(schema.workTeamMember.teamId, item.id), eq(schema.workTeamMember.personId, leaver)));
          await record({ ref: { teamId: item.id, duty: "team_lead" } });
          break;
        case "time_week":
          break;
      }
    }
    await tx.update(schema.workExitHandover).set({ updatedAt: new Date() }).where(eq(schema.workExitHandover.id, handoverId));
    return { moved: chosen.map(({ kind, id, label }) => ({ kind, id, label })), leaver, directory, clients };
  });
  await Promise.all([result.directory ? invalidateWorkDirectory() : null, result.clients ? invalidateWorkClients() : null]);
  return { moved: result.moved, remaining: (await listOwnership(result.leaver)).length };
}

/**
 * Completing the step from the handover page: the engine's own completion (and so the guard) —
 * refused while anything is left; done, the handover is done too.
 */
export async function completeExitHandover(handoverId: string, actorPersonId: string): Promise<ExitHandoverRow> {
  const handover = await findExitHandover(handoverId);
  if (!handover || handover.status !== "open") throw new ActionError("exit_handover_closed");
  if (handover.taskId) await setTaskStatus(handover.taskId, "done", actorPersonId);
  else if (!ownershipSummary(await listOwnership(handover.personId)).clear) throw new ActionError("work_handover_open");
  const [after] = await db().update(schema.workExitHandover).set({ status: "done", doneAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.workExitHandover.id, handoverId), eq(schema.workExitHandover.status, "open"))).returning();
  return after ?? handover;
}
