// Leave cover (FR-PJM-44). Pull, don't push: the leave module never calls work. A job — and the
// person's own screens, on demand — read leave requests (pending and approved) through the leave
// module's service; a request of at least the person's `coverMinDays` working days (the daily
// module's team rules) gets a draft plan listing what falls in the absence. The person names a
// cover per item or one for all, with a note, and submits: each cover is asked (a `cover` hand-off)
// and takes the work over on the leave's first day — at once if it has started. After the leave,
// "hand back" returns it. A leave that is withdrawn, rejected or cancelled cancels a plan that has
// not started.
import "server-only";
import { and, asc, eq, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { type LeaveCoverFact, listLeaveForCover } from "../leave/service";
import { notify } from "../platform/notifications/service";
import { type CoverCandidates, type CoverItemType, type CoverSelection, coverOf, coverStartsOn, movesOnCover, needsCover, reconcileItems, selectCoverItems } from "./engine/cover";
import { normalizeNote, type Note } from "./engine/handoff";
import type { RecurrenceRule } from "./engine/recurrence";
import { canViewProject, canViewTask, canViewTeamBacklog, type CoverPlanFacts, type WorkViewer } from "./policy";
import { projectFacts } from "./projects";
import { loadTasks, logActivity, taskKey, updateWorkTaskIn, WORK_KIND } from "./tasks";
import { teamFacts } from "./teams";
import { viewerOfPerson } from "./viewer";

type Executor = Tx | ReturnType<typeof db>;
// The daily module (team rules) and the project layer (bookings) both build on work: work reads
// them through their services, loaded when first needed so the modules never import each other at
// load time.
const dailyService = () => import("../daily/service");
const projectsService = () => import("../projects/service");
export type CoverPlanRow = typeof schema.workCoverPlan.$inferSelect;
export type CoverItemRow = typeof schema.workCoverItem.$inferSelect;

export const coverLink = (planId: string) => `/work/cover/${planId}`;
const OPEN = ["draft", "submitted"];
const live = isNull(schema.task.deletedAt);
const formatDay = (date: IsoDate) => date.split("-").reverse().join("/");

// ── What falls in an absence ────────────────────────────────────────────────────────────────

/**
 * Read outside any transaction: the bookings come from the project layer's own reads, which use
 * their own connection.
 */
async function candidatesOf(personId: string, absence: { from: IsoDate; to: IsoDate }): Promise<CoverCandidates> {
  const tx = db();
  const [tasks, reviews, recurrences, projects] = await Promise.all([
    tx
      .select({ id: schema.task.id, dueDate: schema.task.dueDate, startDate: schema.task.startDate })
      .from(schema.task)
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .where(and(eq(schema.task.kind, WORK_KIND), live, eq(schema.task.assigneePersonId, personId), inArray(schema.task.status, ["todo", "in_progress"]), or(isNull(schema.workTask.triageStatus), eq(schema.workTask.triageStatus, "accepted")))),
    tx
      .select({ taskId: schema.workTask.taskId })
      .from(schema.workTask)
      .innerJoin(schema.task, and(eq(schema.task.id, schema.workTask.taskId), live))
      .where(and(eq(schema.workTask.reviewerPersonId, personId), eq(schema.workTask.reviewStatus, "submitted"))),
    tx
      .select({ id: schema.workRecurrence.id, rule: schema.workRecurrence.rule, startDate: schema.workRecurrence.startDate, endDate: schema.workRecurrence.endDate })
      .from(schema.workRecurrence)
      .where(and(eq(schema.workRecurrence.isActive, true), sql`${schema.workRecurrence.draft}->>'assigneePersonId' = ${personId}`)),
    tx
      .select({ projectId: schema.workProjectMember.projectId })
      .from(schema.workProjectMember)
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.workProjectMember.projectId))
      .where(and(eq(schema.workProjectMember.personId, personId), notInArray(schema.workProject.status, ["done", "archived"]))),
  ]);
  // Bookings are the project layer's: read through its service, project by project (a person is
  // booked on the projects they work in).
  const { listProjectBookings, mondayOf } = await projectsService();
  const weekFrom = mondayOf(absence.from);
  const bookings = (await Promise.all(projects.map((row) => listProjectBookings(row.projectId, weekFrom, absence.to)))).flat().filter((booking) => booking.personId === personId);
  return { tasks, reviews, recurrences: recurrences.map((row) => ({ ...row, rule: row.rule as RecurrenceRule })), bookings: bookings.map((booking) => ({ id: booking.id, weekStart: booking.weekStart })) };
}

const selectionFor = async (personId: string, absence: { from: IsoDate; to: IsoDate }): Promise<CoverSelection> => selectCoverItems(await candidatesOf(personId, absence), absence);

async function refreshItems(tx: Executor, plan: CoverPlanRow, fresh: CoverSelection): Promise<void> {
  const current = await tx.select().from(schema.workCoverItem).where(eq(schema.workCoverItem.planId, plan.id));
  const { add, remove } = reconcileItems(current, fresh);
  if (add.length) await tx.insert(schema.workCoverItem).values(add.map((item) => ({ planId: plan.id, ...item }))).onConflictDoNothing();
  if (remove.length) await tx.delete(schema.workCoverItem).where(inArray(schema.workCoverItem.id, remove.map((item) => item.id)));
}

/**
 * Who may take each item over: the people of its team and of its project who have not left — the
 * same people a task there can be given to (`listAssignable`). A private project's task never goes
 * to someone outside it. Keyed by item; bookings are information, not duties, and are not here.
 */
async function eligibleCovers(tx: Executor, items: readonly Pick<CoverItemRow, "id" | "itemType" | "itemId">[]): Promise<Map<string, Set<string>>> {
  const taskIds = items.filter((item) => item.itemType === "task" || item.itemType === "review").map((item) => item.itemId);
  const recurrenceIds = items.filter((item) => item.itemType === "recurrence").map((item) => item.itemId);
  const [tasks, recurrences] = await Promise.all([
    taskIds.length ? tx.select({ id: schema.workTask.taskId, teamId: schema.workTask.teamId, projectId: schema.workTask.projectId }).from(schema.workTask).where(inArray(schema.workTask.taskId, taskIds)) : [],
    recurrenceIds.length ? tx.select({ id: schema.workRecurrence.id, teamId: schema.workRecurrence.teamId, projectId: schema.workRecurrence.projectId }).from(schema.workRecurrence).where(inArray(schema.workRecurrence.id, recurrenceIds)) : [],
  ]);
  const scopes = new Map([...tasks, ...recurrences].map((row) => [row.id, row]));
  const teamIds = [...new Set([...scopes.values()].map((scope) => scope.teamId))];
  const projectIds = [...new Set([...scopes.values()].flatMap((scope) => (scope.projectId ? [scope.projectId] : [])))];
  const active = sql`${schema.person.status} <> 'offboarded'`;
  const [teamPeople, projectPeople] = await Promise.all([
    teamIds.length ? tx.select({ scopeId: schema.workTeamMember.teamId, personId: schema.workTeamMember.personId }).from(schema.workTeamMember).innerJoin(schema.person, eq(schema.person.id, schema.workTeamMember.personId)).where(and(inArray(schema.workTeamMember.teamId, teamIds), active)) : [],
    projectIds.length ? tx.select({ scopeId: schema.workProjectMember.projectId, personId: schema.workProjectMember.personId }).from(schema.workProjectMember).innerJoin(schema.person, eq(schema.person.id, schema.workProjectMember.personId)).where(and(inArray(schema.workProjectMember.projectId, projectIds), active)) : [],
  ]);
  const byTeam = Map.groupBy(teamPeople, (row) => row.scopeId);
  const byProject = Map.groupBy(projectPeople, (row) => row.scopeId);
  const result = new Map<string, Set<string>>();
  for (const item of items) {
    const scope = scopes.get(item.itemId);
    if (!scope) continue;
    const people = [...(byTeam.get(scope.teamId) ?? []), ...(scope.projectId ? (byProject.get(scope.projectId) ?? []) : [])];
    result.set(item.id, new Set(people.map((row) => row.personId)));
  }
  return result;
}

/**
 * Who covers an item: its own cover, or the one for all where that person may take it — a default
 * cover outside an item's project leaves the item uncovered, for the person to choose someone else.
 */
const coverWithin = (item: Pick<CoverItemRow, "id" | "itemType" | "coverPersonId">, defaultCoverPersonId: string | null, eligible: ReadonlyMap<string, ReadonlySet<string>>): string | null => {
  if (item.coverPersonId) return item.coverPersonId;
  if (!defaultCoverPersonId) return null;
  return !movesOnCover(item.itemType as CoverItemType) || eligible.get(item.id)?.has(defaultCoverPersonId) ? defaultCoverPersonId : null;
};

// ── The job, and the on-demand check ────────────────────────────────────────────────────────

/**
 * Reads the leave requests still to come (of one person, or everyone) and brings the plans in
 * line: drafts for new long-enough leave, drafts refreshed while the person has not submitted,
 * plans of ended leave cancelled if they had not started, and submitted plans whose leave has
 * begun applied. Safe to run any number of times.
 */
export async function syncCoverPlans(today: IsoDate, options: { personId?: string } = {}): Promise<{ drafted: number; refreshed: number; cancelled: number; applied: number }> {
  const result = { drafted: 0, refreshed: 0, cancelled: 0, applied: 0 };
  const upcoming = await listLeaveForCover({ endOnOrAfter: today, personId: options.personId });
  const open = await db().select().from(schema.workCoverPlan).where(and(inArray(schema.workCoverPlan.status, OPEN), options.personId ? eq(schema.workCoverPlan.personId, options.personId) : undefined));
  const missing = open.map((plan) => plan.leaveRequestId).filter((id) => !upcoming.some((fact) => fact.id === id));
  const facts: LeaveCoverFact[] = [...upcoming, ...(missing.length ? await listLeaveForCover({ requestIds: missing }) : [])];
  const known = new Map((facts.length ? await db().select().from(schema.workCoverPlan).where(inArray(schema.workCoverPlan.leaveRequestId, facts.map((fact) => fact.id))) : []).map((plan) => [plan.leaveRequestId, plan]));
  const rules = await (await dailyService()).rulesOfPeople(facts.map((fact) => fact.personId));

  for (const fact of facts) {
    const plan = known.get(fact.id);
    if (fact.state === "ended") {
      if (plan && OPEN.includes(plan.status) && !plan.appliedAt) {
        await db().transaction(async (tx) => {
          await tx.update(schema.workCoverPlan).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.workCoverPlan.id, plan.id));
          await cancelCoverHandoffs(tx, plan.id);
        });
        result.cancelled += 1;
      }
      continue;
    }
    if (!plan) {
      if (!needsCover(fact.workingDays, rules.get(fact.personId)?.rules.coverMinDays ?? 2) || fact.endDate < today) continue;
      const fresh = await selectionFor(fact.personId, { from: fact.startDate, to: fact.endDate });
      await db().transaction(async (tx) => {
        const [created] = await tx.insert(schema.workCoverPlan).values({ personId: fact.personId, leaveRequestId: fact.id, fromDate: fact.startDate, toDate: fact.endDate }).onConflictDoNothing().returning();
        if (created) await refreshItems(tx, created, fresh);
      });
      result.drafted += 1;
      continue;
    }
    if (plan.status === "draft") {
      const fresh = await selectionFor(fact.personId, { from: fact.startDate, to: fact.endDate });
      await db().transaction(async (tx) => {
        const [current] = await tx.update(schema.workCoverPlan).set({ fromDate: fact.startDate, toDate: fact.endDate, updatedAt: new Date() }).where(and(eq(schema.workCoverPlan.id, plan.id), eq(schema.workCoverPlan.status, "draft"))).returning();
        if (current) await refreshItems(tx, current, fresh);
      });
      result.refreshed += 1;
    }
  }

  const starting = await db()
    .select()
    .from(schema.workCoverPlan)
    .where(and(eq(schema.workCoverPlan.status, "submitted"), isNull(schema.workCoverPlan.appliedAt), lte(schema.workCoverPlan.fromDate, today), options.personId ? eq(schema.workCoverPlan.personId, options.personId) : undefined));
  for (const plan of starting) {
    if (await db().transaction((tx) => applyCoverPlan(tx, plan.id))) result.applied += 1;
  }
  return result;
}

async function cancelCoverHandoffs(tx: Executor, planId: string): Promise<void> {
  const handoffIds = (await tx.select({ id: schema.workCoverItem.handoffId }).from(schema.workCoverItem).where(eq(schema.workCoverItem.planId, planId))).map((row) => row.id).filter((id): id is string => !!id);
  if (handoffIds.length) await tx.update(schema.workHandoff).set({ status: "cancelled" }).where(and(inArray(schema.workHandoff.id, handoffIds), eq(schema.workHandoff.status, "pending")));
}

/**
 * The covers take the work over: tasks and review duties still with the person, recurrences whose
 * occurrences go to them. Only what is still the person's moves (a lead may have reassigned
 * something meanwhile). Claimed by `applied_at`, so it happens once.
 */
async function applyCoverPlan(tx: Executor, planId: string): Promise<boolean> {
  const [plan] = await tx.update(schema.workCoverPlan).set({ appliedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.workCoverPlan.id, planId), eq(schema.workCoverPlan.status, "submitted"), isNull(schema.workCoverPlan.appliedAt))).returning();
  if (!plan) return false;
  const items = await tx.select().from(schema.workCoverItem).where(eq(schema.workCoverItem.planId, planId));
  // Checked again on the day: a cover who has left the project since the plan was submitted does
  // not take its work over — the item stays with the person.
  const eligible = await eligibleCovers(tx, items);
  for (const item of items) {
    const cover = coverOf(item, plan.defaultCoverPersonId);
    if (!cover || !movesOnCover(item.itemType as CoverItemType) || !eligible.get(item.id)?.has(cover)) continue;
    await moveItem(tx, item, plan.personId, cover, null);
  }
  return true;
}

/** One item from one person to another, if the first still holds it. */
async function moveItem(tx: Executor, item: CoverItemRow, from: string, to: string, actorPersonId: string | null): Promise<boolean> {
  if (item.itemType === "task") {
    const [row] = await tx.select({ assignee: schema.task.assigneePersonId, status: schema.task.status }).from(schema.task).where(and(eq(schema.task.id, item.itemId), live)).limit(1);
    if (!row || row.assignee !== from || (row.status !== "todo" && row.status !== "in_progress")) return false;
    await updateWorkTaskIn(tx, item.itemId, { assigneePersonId: to }, actorPersonId, { silent: true, handoff: "system" });
    return true;
  }
  if (item.itemType === "review") {
    const moved = await tx.update(schema.workTask).set({ reviewerPersonId: to }).where(and(eq(schema.workTask.taskId, item.itemId), eq(schema.workTask.reviewerPersonId, from))).returning({ id: schema.workTask.taskId });
    if (moved.length) await logActivity(tx, item.itemId, actorPersonId, [{ type: "field_changed", field: "reviewer", from: { id: from }, to: { id: to } }]);
    return moved.length > 0;
  }
  if (item.itemType === "recurrence") {
    const moved = await tx
      .update(schema.workRecurrence)
      .set({ draft: sql`jsonb_set(${schema.workRecurrence.draft}, '{assigneePersonId}', to_jsonb(${to}::text))`, updatedAt: new Date() })
      .where(and(eq(schema.workRecurrence.id, item.itemId), sql`${schema.workRecurrence.draft}->>'assigneePersonId' = ${from}`))
      .returning({ id: schema.workRecurrence.id });
    return moved.length > 0;
  }
  return false;
}

// ── The person's plan ───────────────────────────────────────────────────────────────────────

export async function findCoverPlan(planId: string, executor: Executor = db()): Promise<CoverPlanRow | undefined> {
  const [row] = await executor.select().from(schema.workCoverPlan).where(eq(schema.workCoverPlan.id, planId)).limit(1);
  return row;
}

/** What the policy needs: the person, their entity, and everyone named as a cover. */
export async function coverPlanFacts(plan: CoverPlanRow, executor: Executor = db()): Promise<CoverPlanFacts> {
  const [[person], items] = await Promise.all([
    executor.select({ entityId: schema.person.primaryEntityId }).from(schema.person).where(eq(schema.person.id, plan.personId)).limit(1),
    executor.select({ coverPersonId: schema.workCoverItem.coverPersonId }).from(schema.workCoverItem).where(eq(schema.workCoverItem.planId, plan.id)),
  ]);
  const coverIds = [...new Set([plan.defaultCoverPersonId, ...items.map((item) => item.coverPersonId)].filter((id): id is string => !!id))];
  return { personId: plan.personId, entityId: person?.entityId ?? null, coverIds };
}

/**
 * `label` null: work the reader may not open (a private project's task, its bookings) — shown as
 * "private work" with no link, never by name. `assignableIds`: who may cover the item.
 */
export type CoverItemView = { id: string; itemType: CoverItemType; itemId: string; label: string | null; detail: string | null; href: string | null; coverPersonId: string | null; coverName: string | null; effectiveCoverName: string | null; acknowledgedAt: Date | null; handedBackAt: Date | null; handoffStatus: string | null; assignableIds: string[] };
export type CoverPlanView = CoverPlanRow & { personName: string; defaultCoverName: string | null; items: CoverItemView[] };

/** The plan as `viewer` may read it: the names of work they may not open are left out. */
export async function getCoverPlan(planId: string, viewer: WorkViewer): Promise<CoverPlanView | undefined> {
  const plan = await findCoverPlan(planId);
  return plan ? viewOf(plan, viewer) : undefined;
}

/** The plan beside a leave request (the approver's panel on the leave page, FR-PJM-44). */
export async function getCoverPlanForLeave(leaveRequestId: string, viewer: WorkViewer): Promise<CoverPlanView | undefined> {
  const [plan] = await db().select().from(schema.workCoverPlan).where(eq(schema.workCoverPlan.leaveRequestId, leaveRequestId)).limit(1);
  return plan ? viewOf(plan, viewer) : undefined;
}

/** The same, for a panel that knows only who is looking (the leave approval page). */
export async function getCoverPlanForLeaveAs(leaveRequestId: string, personId: string): Promise<CoverPlanView | undefined> {
  const viewer = await viewerOfPerson(db(), personId);
  return viewer ? getCoverPlanForLeave(leaveRequestId, viewer) : undefined;
}

async function viewOf(plan: CoverPlanRow, viewer: WorkViewer): Promise<CoverPlanView> {
  const items = await db().select({ item: schema.workCoverItem, coverName: schema.person.fullName, handoffStatus: schema.workHandoff.status }).from(schema.workCoverItem).leftJoin(schema.person, eq(schema.person.id, schema.workCoverItem.coverPersonId)).leftJoin(schema.workHandoff, eq(schema.workHandoff.id, schema.workCoverItem.handoffId)).where(eq(schema.workCoverItem.planId, plan.id));
  const idsOf = (type: CoverItemType) => items.filter((row) => row.item.itemType === type).map((row) => row.item.itemId);
  const taskIds = [...idsOf("task"), ...idsOf("review")];
  const [people, loaded, recurrences, bookings, eligible] = await Promise.all([
    db().select({ id: schema.person.id, name: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, [plan.personId, plan.defaultCoverPersonId].filter((id): id is string => !!id))),
    loadTasks(taskIds),
    idsOf("recurrence").length
      ? db().select({ recurrence: schema.workRecurrence, team: schema.workTeam, project: schema.workProject }).from(schema.workRecurrence).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workRecurrence.teamId)).leftJoin(schema.workProject, eq(schema.workProject.id, schema.workRecurrence.projectId)).where(inArray(schema.workRecurrence.id, idsOf("recurrence")))
      : [],
    idsOf("booking").length ? bookingLabels(plan, idsOf("booking"), viewer) : [],
    eligibleCovers(db(), items.map((row) => row.item)),
  ]);
  const nameOf = (id: string | null) => (id ? (people.find((person) => person.id === id)?.name ?? null) : null);
  const defaultCoverName = nameOf(plan.defaultCoverPersonId);
  const order: CoverItemType[] = ["task", "review", "recurrence", "booking"];
  return {
    ...plan,
    personName: nameOf(plan.personId) ?? "",
    defaultCoverName,
    items: items
      .map(({ item, coverName, handoffStatus }): CoverItemView => {
        const found = loaded.get(item.itemId);
        const task = found && canViewTask(viewer, found.facts) ? found : null;
        const row = recurrences.find((entry) => entry.recurrence.id === item.itemId);
        const recurrence = row && (row.project ? canViewProject(viewer, projectFacts(row.project, row.team)) : canViewTeamBacklog(viewer, teamFacts(row.team))) ? row.recurrence : null;
        const booking = bookings.find((entry) => entry.id === item.itemId);
        const type = item.itemType as CoverItemType;
        const label = task ? `${taskKey(task.team.key, task.work.number)} ${task.task.title}` : (recurrence?.title ?? booking?.label ?? null);
        const detail = task?.task.dueDate ? formatDay(task.task.dueDate) : (booking?.detail ?? null);
        const href = task ? `/work/tasks/${task.task.id}` : null;
        // The one for all counts only where that person may take the item.
        const effective = item.coverPersonId ? coverName : type === "booking" || !coverWithin(item, plan.defaultCoverPersonId, eligible) ? null : defaultCoverName;
        const assignableIds = label === null ? [] : [...(eligible.get(item.id) ?? [])];
        return { id: item.id, itemType: type, itemId: item.itemId, label, detail, href, coverPersonId: item.coverPersonId, coverName, effectiveCoverName: effective, acknowledgedAt: item.acknowledgedAt, handedBackAt: item.handedBackAt, handoffStatus, assignableIds };
      })
      .sort((a, b) => order.indexOf(a.itemType) - order.indexOf(b.itemType) || (a.label ?? "").localeCompare(b.label ?? "", "vi")),
  };
}

/** A booking reads as its project's name — for a reader who may open that project. */
async function bookingLabels(plan: CoverPlanRow, bookingIds: string[], viewer: WorkViewer): Promise<{ id: string; label: string; detail: string }[]> {
  const { listProjectBookings, mondayOf } = await projectsService();
  const projects = await db().select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProjectMember).innerJoin(schema.workProject, eq(schema.workProject.id, schema.workProjectMember.projectId)).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)).where(eq(schema.workProjectMember.personId, plan.personId));
  const readable = projects.filter(({ project, team }) => canViewProject(viewer, projectFacts(project, team))).map(({ project }) => project);
  const rows = (await Promise.all(readable.map(async (project) => (await listProjectBookings(project.id, mondayOf(plan.fromDate), plan.toDate)).map((booking) => ({ booking, project }))))).flat();
  return rows.filter(({ booking }) => bookingIds.includes(booking.id)).map(({ booking, project }) => ({ id: booking.id, label: project.name, detail: `${formatDay(booking.weekStart)} · ${Math.round(booking.minutes / 60)}h` }));
}

export type CoverPlanSummary = { id: string; personName: string; fromDate: IsoDate; toDate: IsoDate; status: string; items: number; mine: boolean; toAcknowledge: number; canHandBack: boolean };

/** For "My work": my own open plans, and plans where I cover something (with what I still have to acknowledge). */
export async function listCoverPlansFor(personId: string, today: IsoDate): Promise<CoverPlanSummary[]> {
  const covering = db().select({ planId: schema.workCoverItem.planId }).from(schema.workCoverItem).where(eq(schema.workCoverItem.coverPersonId, personId));
  const rows = await db()
    .select({
      id: schema.workCoverPlan.id,
      personId: schema.workCoverPlan.personId,
      personName: schema.person.fullName,
      fromDate: schema.workCoverPlan.fromDate,
      toDate: schema.workCoverPlan.toDate,
      status: schema.workCoverPlan.status,
      appliedAt: schema.workCoverPlan.appliedAt,
      defaultCoverPersonId: schema.workCoverPlan.defaultCoverPersonId,
      items: sql<number>`(select count(*)::int from work_cover_item i where i.plan_id = work_cover_plan.id)`,
      toAcknowledge: sql<number>`(select count(*)::int from work_cover_item i where i.plan_id = work_cover_plan.id and i.acknowledged_at is null and i.handed_back_at is null and coalesce(i.cover_person_id, work_cover_plan.default_cover_person_id) = ${personId} and i.item_type <> 'booking')`,
    })
    .from(schema.workCoverPlan)
    .innerJoin(schema.person, eq(schema.person.id, schema.workCoverPlan.personId))
    .where(and(inArray(schema.workCoverPlan.status, OPEN), or(eq(schema.workCoverPlan.personId, personId), eq(schema.workCoverPlan.defaultCoverPersonId, personId), inArray(schema.workCoverPlan.id, covering))))
    .orderBy(asc(schema.workCoverPlan.fromDate));
  return rows.map((row) => ({
    id: row.id,
    personName: row.personName,
    fromDate: row.fromDate,
    toDate: row.toDate,
    status: row.status,
    items: Number(row.items),
    mine: row.personId === personId,
    toAcknowledge: row.status === "submitted" ? Number(row.toAcknowledge) : 0,
    canHandBack: row.status === "submitted" && !!row.appliedAt && row.toDate <= today,
  }));
}

// ── Filling, submitting, acknowledging, handing back ────────────────────────────────────────

export type CoverChoice = { defaultCoverPersonId: string | null; items: { id: string; coverPersonId: string | null }[]; note: Note };

/** Saves the choices; a cover named for an item must be someone who may take it (`eligibleCovers`). */
async function saveChoice(tx: Executor, plan: CoverPlanRow, choice: CoverChoice): Promise<{ items: CoverItemRow[]; eligible: Map<string, Set<string>> }> {
  const covers = [...new Set([choice.defaultCoverPersonId, ...choice.items.map((item) => item.coverPersonId)].filter((id): id is string => !!id))];
  if (covers.includes(plan.personId)) throw new ActionError("cover_self");
  if (covers.length) {
    const people = await tx.select({ id: schema.person.id, status: schema.person.status }).from(schema.person).where(inArray(schema.person.id, covers));
    if (people.length !== covers.length || people.some((person) => person.status === "offboarded")) throw new ActionError("person_not_found");
  }
  const items = await tx.select().from(schema.workCoverItem).where(eq(schema.workCoverItem.planId, plan.id));
  for (const wanted of choice.items) {
    const item = items.find((row) => row.id === wanted.id);
    if (!item) throw new ActionError("cover_item_not_found");
    if (item.coverPersonId !== wanted.coverPersonId) await tx.update(schema.workCoverItem).set({ coverPersonId: wanted.coverPersonId }).where(eq(schema.workCoverItem.id, item.id));
    item.coverPersonId = wanted.coverPersonId;
  }
  const eligible = await eligibleCovers(tx, items);
  const outside = items.filter((item) => item.coverPersonId && movesOnCover(item.itemType as CoverItemType) && !eligible.get(item.id)?.has(item.coverPersonId));
  if (outside.length) throw new ActionError("cover_not_assignable", { count: outside.length });
  await tx.update(schema.workCoverPlan).set({ defaultCoverPersonId: choice.defaultCoverPersonId, note: normalizeNote(choice.note), updatedAt: new Date() }).where(eq(schema.workCoverPlan.id, plan.id));
  return { items, eligible };
}

/** The plan row, locked for the rest of the transaction: two submits (or hand-backs) at once run one after the other. */
async function lockCoverPlan(tx: Executor, planId: string): Promise<CoverPlanRow | undefined> {
  const [row] = await tx.select().from(schema.workCoverPlan).where(eq(schema.workCoverPlan.id, planId)).limit(1).for("update");
  return row;
}

/** Saves the choices of a draft without asking anyone yet. */
export async function saveCoverPlan(planId: string, choice: CoverChoice): Promise<CoverPlanRow> {
  return db().transaction(async (tx) => {
    const plan = await lockCoverPlan(tx, planId);
    if (!plan || plan.status !== "draft") throw new ActionError("cover_plan_not_draft");
    await saveChoice(tx, plan, choice);
    return (await findCoverPlan(planId, tx))!;
  });
}

/**
 * Every item that moves must have a cover (its own, or the one for all where that person may take
 * it); bookings are only information. Each cover gets one notice however many items they cover.
 * The plan row is locked first, so a double submit makes one set of hand-offs, not two.
 */
export async function submitCoverPlan(planId: string, choice: CoverChoice, actor: { personId: string; fullName: string }, today: IsoDate): Promise<{ plan: CoverPlanRow; covers: string[]; applied: boolean }> {
  return db().transaction(async (tx) => {
    const plan = await lockCoverPlan(tx, planId);
    if (!plan || plan.status !== "draft") throw new ActionError("cover_plan_not_draft");
    const { items, eligible } = await saveChoice(tx, plan, choice);
    const coverFor = (item: CoverItemRow) => coverWithin(item, choice.defaultCoverPersonId, eligible);
    const moving = items.filter((item) => movesOnCover(item.itemType as CoverItemType));
    const uncovered = moving.filter((item) => !coverFor(item));
    if (uncovered.length) throw new ActionError("cover_item_uncovered", { count: uncovered.length });
    const note = normalizeNote(choice.note);
    const [person] = await tx.select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, plan.personId)).limit(1);
    for (const item of items) {
      const cover = coverFor(item);
      if (!cover) continue;
      const onTask = item.itemType === "task" || item.itemType === "review";
      const [handoff] = await tx
        .insert(schema.workHandoff)
        .values({ taskId: onTask ? item.itemId : null, kind: "cover", fromPersonId: plan.personId, toPersonId: cover, note, status: "pending", sourceRef: { leaveRequestId: plan.leaveRequestId, coverPlanId: plan.id, itemType: item.itemType, itemId: item.itemId }, createdByPersonId: actor.personId })
        .returning();
      await tx.update(schema.workCoverItem).set({ coverPersonId: item.coverPersonId, handoffId: handoff.id }).where(eq(schema.workCoverItem.id, item.id));
      if (onTask) await logActivity(tx, item.itemId, actor.personId, [{ type: "cover_requested", to: { id: cover, name: formatDay(plan.fromDate) } }]);
    }
    const [after] = await tx.update(schema.workCoverPlan).set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() }).where(eq(schema.workCoverPlan.id, planId)).returning();
    const byCover = Map.groupBy(
      items.filter((item) => coverFor(item)),
      (item) => coverFor(item)!,
    );
    for (const [cover, own] of byCover) await notify({ recipients: [cover], kind: "tasks.cover_requested", params: { actor: person?.name ?? actor.fullName, from: formatDay(plan.fromDate), to: formatDay(plan.toDate), count: own.length }, link: coverLink(plan.id) }, tx);
    const applied = coverStartsOn({ from: plan.fromDate, to: plan.toDate }, today) ? await applyCoverPlan(tx, planId) : false;
    return { plan: after, covers: [...byCover.keys()], applied };
  });
}

/** The cover has seen what they take over. */
export async function acknowledgeCover(planId: string, actor: { personId: string; fullName: string }): Promise<number> {
  return db().transaction(async (tx) => {
    const plan = await findCoverPlan(planId, tx);
    if (!plan || plan.status !== "submitted") throw new ActionError("cover_plan_not_submitted");
    const items = await tx.select().from(schema.workCoverItem).where(and(eq(schema.workCoverItem.planId, planId), isNull(schema.workCoverItem.acknowledgedAt)));
    const mine = items.filter((item) => coverOf(item, plan.defaultCoverPersonId) === actor.personId);
    if (mine.length === 0) return 0;
    await tx.update(schema.workCoverItem).set({ acknowledgedAt: new Date() }).where(inArray(schema.workCoverItem.id, mine.map((item) => item.id)));
    const handoffIds = mine.map((item) => item.handoffId).filter((id): id is string => !!id);
    if (handoffIds.length) await tx.update(schema.workHandoff).set({ status: "accepted", respondedByPersonId: actor.personId, respondedAt: new Date() }).where(and(inArray(schema.workHandoff.id, handoffIds), eq(schema.workHandoff.status, "pending")));
    return mine.length;
  });
}

/**
 * Back from leave: what the covers still hold goes back to the person, each as a `cover_return`
 * hand-off; covers hear once each. Before the leave has started there is nothing to give back —
 * the plan is simply withdrawn and the covers' requests cancelled, which only the person (or whoever
 * may submit for them) does.
 *
 * `whole`: the person, or whoever may submit the plan, hands back everything; a cover hands back only
 * what they hold. Either way not before the leave's last day — a cover cannot drop the work halfway
 * through the absence. The plan is over once nothing is left with a cover.
 */
export async function handBackCover(planId: string, actor: { personId: string; fullName: string }, today: IsoDate, options: { whole: boolean }): Promise<{ returned: number; covers: string[] }> {
  return db().transaction(async (tx) => {
    const plan = await lockCoverPlan(tx, planId);
    if (!plan || plan.status !== "submitted") throw new ActionError("cover_plan_not_submitted");
    const pending = await tx.select().from(schema.workCoverItem).where(and(eq(schema.workCoverItem.planId, planId), isNull(schema.workCoverItem.handedBackAt)));
    if (!plan.appliedAt) {
      if (!options.whole) throw new ActionError("cover_plan_not_started");
      await tx.update(schema.workCoverPlan).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.workCoverPlan.id, planId));
      await cancelCoverHandoffs(tx, planId);
      return { returned: 0, covers: [] };
    }
    if (today < plan.toDate) throw new ActionError("cover_hand_back_early", { date: formatDay(plan.toDate) });
    const items = options.whole ? pending : pending.filter((item) => coverOf(item, plan.defaultCoverPersonId) === actor.personId);
    if (items.length === 0) throw new ActionError("cover_nothing_to_hand_back");
    const [person] = await tx.select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, plan.personId)).limit(1);
    const returnedBy = new Map<string, number>();
    let returned = 0;
    for (const item of items) {
      const cover = coverOf(item, plan.defaultCoverPersonId);
      if (!cover || !movesOnCover(item.itemType as CoverItemType)) continue;
      const moved = await moveItem(tx, item, cover, plan.personId, actor.personId);
      await tx.update(schema.workCoverItem).set({ handedBackAt: new Date() }).where(eq(schema.workCoverItem.id, item.id));
      if (!moved) continue;
      returned += 1;
      returnedBy.set(cover, (returnedBy.get(cover) ?? 0) + 1);
      if (item.itemType === "task" || item.itemType === "review") {
        await tx.insert(schema.workHandoff).values({ taskId: item.itemId, kind: "cover_return", fromPersonId: cover, toPersonId: plan.personId, status: "recorded", sourceRef: { leaveRequestId: plan.leaveRequestId, coverPlanId: plan.id }, createdByPersonId: actor.personId });
        await logActivity(tx, item.itemId, actor.personId, [{ type: "cover_handed_back", to: { id: plan.personId, name: person?.name ?? "" } }]);
      }
    }
    // Bookings are never handed back (they never moved): the plan is over when no duty is left with a cover.
    const left = pending.filter((item) => !items.includes(item) && movesOnCover(item.itemType as CoverItemType) && coverOf(item, plan.defaultCoverPersonId));
    if (left.length === 0) await tx.update(schema.workCoverPlan).set({ status: "handed_back", updatedAt: new Date() }).where(eq(schema.workCoverPlan.id, planId));
    for (const [cover, count] of returnedBy) await notify({ recipients: [cover], kind: "tasks.cover_handed_back", params: { actor: person?.name ?? actor.fullName, count }, link: coverLink(plan.id) }, tx);
    return { returned, covers: [...returnedBy.keys()] };
  });
}
