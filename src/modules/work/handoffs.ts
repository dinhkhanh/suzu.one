// Hand-offs (FR-PJM-40..43, 46): the packages a team asks for on a workflow transition, handing a
// task on with a filled package, the receiver accepting or returning it, sending work on to another
// team through its triage, handing a client relationship over — and the history and statistics
// they leave. Every kind writes one `work_handoff` row with the same note shape (FR-PJM-43).
import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import vi from "../../../messages/vi.json";
import { notify } from "../platform/notifications/service";
import { runTaskAutomations } from "./automations";
import { invalidateWorkDirectory } from "./directory";
import { type HandoffStatus, keptValues, missingItems, normalizeNote, type Note, noteIsEmpty, packageProblem, type PackageField, stageOutcome } from "./engine/handoff";
import { findPackageFor, type HandoffPackageRow } from "./handoff-gate";
import { canManageProject, canViewTask, type WorkViewer } from "./policy";
import { projectFacts } from "./projects";
import { type LoadedTask, createWorkTaskIn, loadTask, loadTasks, logActivity, taskKey, updateWorkTaskIn } from "./tasks";
import { invalidateWorkClients } from "./teams";
import { sendToTriage } from "./triage";

type Executor = Tx | ReturnType<typeof db>;
type Actor = { personId: string; fullName: string };
export type HandoffRow = typeof schema.workHandoff.$inferSelect;

const taskLink = (taskId: string) => `/work/tasks/${taskId}`;
const keyOf = (loaded: LoadedTask) => taskKey(loaded.team.key, loaded.work.number);
const named = (loaded: LoadedTask) => `${keyOf(loaded)} ${loaded.task.title}`;
const newId = () => crypto.randomUUID().slice(0, 8);

async function activePerson(tx: Executor, personId: string): Promise<{ id: string; name: string; workforceType: string | null }> {
  const [row] = await tx.select({ id: schema.person.id, name: schema.person.fullName, status: schema.person.status, workforceType: schema.person.workforceType }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
  if (!row || row.status === "offboarded") throw new ActionError("person_not_found");
  return { id: row.id, name: row.name, workforceType: row.workforceType };
}

// ── Packages (FR-PJM-40) ────────────────────────────────────────────────────────────────────

export type PackageInput = {
  name: string;
  fromStateId: string | null;
  toStateId: string;
  fields: { key?: string | null; label: string; type: PackageField["type"]; required: boolean }[];
  checklist: { id?: string | null; text: string }[];
  requireLink: boolean;
  requireFile: boolean;
  requireAccept: boolean;
  isActive: boolean;
};

export async function findPackage(packageId: string): Promise<HandoffPackageRow | undefined> {
  const [row] = await db().select().from(schema.workHandoffPackage).where(eq(schema.workHandoffPackage.id, packageId)).limit(1);
  return row;
}

/**
 * Keys are the service's: a field keeps its key when it is edited (hand-offs already made read
 * their answers by it), a new one gets a fresh key. Both states must be the team's own.
 */
export async function savePackage(teamId: string, packageId: string | null, input: PackageInput, actorPersonId: string): Promise<{ before: HandoffPackageRow | null; after: HandoffPackageRow }> {
  return db().transaction(async (tx) => {
    const stateIds = [input.toStateId, input.fromStateId].filter((id): id is string => !!id);
    const states = await tx.select({ id: schema.workState.id }).from(schema.workState).where(and(inArray(schema.workState.id, stateIds), eq(schema.workState.teamId, teamId)));
    if (states.length !== new Set(stateIds).size) throw new ActionError("state_not_found");
    const values = {
      name: input.name,
      fromStateId: input.fromStateId,
      toStateId: input.toStateId,
      fields: input.fields.map((field) => ({ key: field.key || `f_${newId()}`, label: field.label.trim(), type: field.type, required: field.required })),
      checklist: input.checklist.map((check) => ({ id: check.id || `c_${newId()}`, text: check.text.trim() })),
      requireLink: input.requireLink,
      requireFile: input.requireFile,
      requireAccept: input.requireAccept,
      isActive: input.isActive,
    };
    const problem = packageProblem(values);
    if (problem) throw new ActionError(problem);
    if (!packageId) {
      const [after] = await tx.insert(schema.workHandoffPackage).values({ teamId, ...values, createdByPersonId: actorPersonId }).returning();
      return { before: null, after };
    }
    const [before] = await tx.select().from(schema.workHandoffPackage).where(eq(schema.workHandoffPackage.id, packageId)).limit(1);
    if (!before || before.teamId !== teamId) throw new ActionError("handoff_package_not_found");
    const [after] = await tx.update(schema.workHandoffPackage).set({ ...values, updatedAt: new Date() }).where(eq(schema.workHandoffPackage.id, packageId)).returning();
    return { before, after };
  });
}

/** Hand-offs made with it stay: their `package_id` is cleared, their answers kept. */
export async function deletePackage(packageId: string): Promise<HandoffPackageRow> {
  const [row] = await db().delete(schema.workHandoffPackage).where(eq(schema.workHandoffPackage.id, packageId)).returning();
  if (!row) throw new ActionError("handoff_package_not_found");
  return row;
}

// ── Stage hand-off (FR-PJM-40, 41) ──────────────────────────────────────────────────────────

export type StageHandoffInput = { toStateId: string; values: Record<string, string>; checked: string[]; links: string[]; fileId: string | null; toPersonId: string | null; note: Note };

/**
 * Moves the task on with its package. Refused with the missing items while the package is not
 * complete (the sheet shows them). With a receiver who must accept, the hand-off waits for them and
 * the task stays with the sender until then; without, it is recorded and the receiver — if one was
 * named — gets the task at once.
 */
export async function handOffStage(taskId: string, input: StageHandoffInput, actor: Actor): Promise<{ handoff: HandoffRow | null; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    const note = normalizeNote({ ...input.note, links: [...(input.note.links ?? []), ...input.links] });
    const pkg = await findPackageFor(tx, loaded.team.id, loaded.work.stateId, input.toStateId);
    if (input.fileId) {
      const [file] = await tx.select({ id: schema.storedFile.id }).from(schema.storedFile).where(and(eq(schema.storedFile.id, input.fileId), eq(schema.storedFile.ownerType, "work_task"), eq(schema.storedFile.ownerId, taskId), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))).limit(1);
      if (!file) throw new ActionError("file_not_found");
    }
    if (pkg) {
      const missing = missingItems(pkg, { values: input.values, checked: input.checked, links: note.links ?? [], fileId: input.fileId });
      if (missing.length) throw new ActionError("handoff_incomplete", { missing });
      if (pkg.requireAccept && !input.toPersonId) throw new ActionError("handoff_receiver_required");
    }
    const receiver = input.toPersonId ? await activePerson(tx, input.toPersonId) : null;
    // No package any more (a lead removed it meanwhile) and nothing to record: a plain move.
    if (!pkg && !receiver && noteIsEmpty(note)) {
      await updateWorkTaskIn(tx, taskId, { stateId: input.toStateId }, actor.personId, { handoff: "filled" });
      return { handoff: null, loaded };
    }
    const status = stageOutcome(pkg?.requireAccept ?? false, receiver?.id ?? null, actor.personId);
    const [handoff] = await tx
      .insert(schema.workHandoff)
      .values({
        taskId,
        kind: "stage",
        packageId: pkg?.id ?? null,
        fromPersonId: actor.personId,
        toPersonId: receiver?.id ?? null,
        fromStateId: loaded.work.stateId,
        toStateId: input.toStateId,
        note,
        packageValues: pkg ? keptValues(pkg, input.values) : {},
        checklist: pkg ? pkg.checklist.map((check) => ({ ...check, done: input.checked.includes(check.id) })) : [],
        fileId: input.fileId,
        status,
        createdByPersonId: actor.personId,
      })
      .returning();
    const handOver = status === "recorded" && receiver && receiver.id !== loaded.task.assigneePersonId;
    await updateWorkTaskIn(tx, taskId, { stateId: input.toStateId, ...(handOver ? { assigneePersonId: receiver.id } : {}) }, actor.personId, { handoff: "filled", quiet: status === "pending" });
    await logActivity(tx, taskId, actor.personId, [{ type: "handoff_sent", to: { name: receiver?.name ?? "—" } }]);
    if (status === "pending") await notify({ recipients: [receiver!.id], kind: "tasks.handoff_received", params: { actor: actor.fullName, task: named(loaded) }, link: taskLink(taskId) }, tx);
    return { handoff, loaded };
  });
}

export async function findHandoff(handoffId: string, executor: Executor = db()): Promise<HandoffRow | undefined> {
  const [row] = await executor.select().from(schema.workHandoff).where(eq(schema.workHandoff.id, handoffId)).limit(1);
  return row;
}

async function pendingHandoff(tx: Executor, handoffId: string): Promise<{ handoff: HandoffRow; loaded: LoadedTask }> {
  const handoff = await findHandoff(handoffId, tx);
  if (!handoff || handoff.status !== "pending" || !handoff.taskId) throw new ActionError("handoff_not_pending");
  // Cross-team work is answered in the receiving team's triage (handoff-settle.ts).
  if (handoff.kind === "cross_team") throw new ActionError("handoff_via_triage");
  const loaded = await loadTask(handoff.taskId, tx);
  if (!loaded) throw new ActionError("task_not_found");
  return { handoff, loaded };
}

/**
 * The receiver takes the task: it becomes theirs (a lead accepting on someone's behalf gives it to
 * the person named). A cover hand-off accepted is the cover acknowledging it (FR-PJM-44).
 */
export async function acceptHandoff(handoffId: string, actor: Actor): Promise<{ handoff: HandoffRow; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const { handoff, loaded } = await pendingHandoff(tx, handoffId);
    const [after] = await tx.update(schema.workHandoff).set({ status: "accepted", respondedByPersonId: actor.personId, respondedAt: new Date() }).where(and(eq(schema.workHandoff.id, handoffId), eq(schema.workHandoff.status, "pending"))).returning();
    if (!after) throw new ActionError("handoff_not_pending");
    const receiver = handoff.toPersonId ?? actor.personId;
    if (handoff.kind === "stage" && loaded.task.assigneePersonId !== receiver) await updateWorkTaskIn(tx, loaded.task.id, { assigneePersonId: receiver }, actor.personId, { quiet: true, handoff: "system" });
    if (handoff.kind === "cover") await tx.update(schema.workCoverItem).set({ acknowledgedAt: new Date() }).where(and(eq(schema.workCoverItem.handoffId, handoffId), isNull(schema.workCoverItem.acknowledgedAt)));
    await logActivity(tx, loaded.task.id, actor.personId, [{ type: "handoff_accepted", to: { name: actor.fullName } }]);
    if (handoff.fromPersonId && handoff.fromPersonId !== actor.personId) await notify({ recipients: [handoff.fromPersonId], kind: "tasks.handoff_accepted", params: { actor: actor.fullName, task: named(loaded) }, link: taskLink(loaded.task.id) }, tx);
    await runTaskAutomations(tx, loaded.task.id, { type: "handoff_accepted" });
    return { handoff: after, loaded };
  });
}

/**
 * Returned with a reason: a stage hand-off goes back where it came from — its state and the person
 * who sent it; a cover hand-off leaves its item without a cover, and anything already taken over
 * goes back to the person on leave, who must find someone else. Counted per task and per stage.
 */
export async function returnHandoff(handoffId: string, reason: string, actor: Actor): Promise<{ handoff: HandoffRow; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const { handoff, loaded } = await pendingHandoff(tx, handoffId);
    const [after] = await tx.update(schema.workHandoff).set({ status: "returned", respondedByPersonId: actor.personId, respondedAt: new Date(), returnReason: reason }).where(and(eq(schema.workHandoff.id, handoffId), eq(schema.workHandoff.status, "pending"))).returning();
    if (!after) throw new ActionError("handoff_not_pending");
    if (handoff.kind === "stage") {
      const [fromState] = handoff.fromStateId ? await tx.select().from(schema.workState).where(eq(schema.workState.id, handoff.fromStateId)).limit(1) : [];
      const [sender] = handoff.fromPersonId ? await tx.select({ status: schema.person.status }).from(schema.person).where(eq(schema.person.id, handoff.fromPersonId)).limit(1) : [];
      await updateWorkTaskIn(
        tx,
        loaded.task.id,
        { ...(fromState?.isActive && fromState.teamId === loaded.team.id ? { stateId: fromState.id } : {}), ...(sender && sender.status !== "offboarded" ? { assigneePersonId: handoff.fromPersonId } : {}) },
        actor.personId,
        { quiet: true, handoff: "system" },
      );
    }
    if (handoff.kind === "cover") await returnCoverItem(tx, handoffId, actor.personId);
    await logActivity(tx, loaded.task.id, actor.personId, [{ type: "handoff_returned", to: { name: reason } }]);
    if (handoff.fromPersonId && handoff.fromPersonId !== actor.personId) await notify({ recipients: [handoff.fromPersonId], kind: "tasks.handoff_returned", params: { actor: actor.fullName, task: named(loaded), reason }, link: taskLink(loaded.task.id) }, tx);
    await runTaskAutomations(tx, loaded.task.id, { type: "handoff_returned" });
    return { handoff: after, loaded };
  });
}

/** A cover who cannot take an item: it is uncovered again, and back with the person if the cover had it already. */
async function returnCoverItem(tx: Executor, handoffId: string, actorPersonId: string): Promise<void> {
  const [item] = await tx.update(schema.workCoverItem).set({ coverPersonId: null, handoffId: null }).where(eq(schema.workCoverItem.handoffId, handoffId)).returning();
  if (!item) return;
  const [plan] = await tx.select().from(schema.workCoverPlan).where(eq(schema.workCoverPlan.id, item.planId)).limit(1);
  if (!plan?.appliedAt) return;
  const [handoff] = await tx.select({ toPersonId: schema.workHandoff.toPersonId }).from(schema.workHandoff).where(eq(schema.workHandoff.id, handoffId)).limit(1);
  const cover = handoff?.toPersonId;
  if (!cover) return;
  if (item.itemType === "task") {
    const [row] = await tx.select({ assignee: schema.task.assigneePersonId }).from(schema.task).where(eq(schema.task.id, item.itemId)).limit(1);
    if (row?.assignee === cover) await updateWorkTaskIn(tx, item.itemId, { assigneePersonId: plan.personId }, actorPersonId, { quiet: true, handoff: "system" });
  }
  if (item.itemType === "review") await tx.update(schema.workTask).set({ reviewerPersonId: plan.personId }).where(and(eq(schema.workTask.taskId, item.itemId), eq(schema.workTask.reviewerPersonId, cover)));
}

// ── Cross-team (FR-PJM-42) ──────────────────────────────────────────────────────────────────

export type CrossTeamInput = { teamId: string; title: string; dueDate: string | null; note: Note };

/**
 * A linked follow-on task in the receiving team, waiting in its triage; the two are linked
 * ("relates"), and the hand-off waits until the receiving lead accepts, declines or merges it.
 */
export async function sendToTeam(taskId: string, input: CrossTeamInput, actor: Actor): Promise<{ handoff: HandoffRow; loaded: LoadedTask; target: { id: string; key: string } }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    if (input.teamId === loaded.team.id) throw new ActionError("handoff_same_team");
    const [team] = await tx.select().from(schema.workTeam).where(eq(schema.workTeam.id, input.teamId)).limit(1);
    if (!team?.isActive) throw new ActionError("team_not_found");
    const note = normalizeNote(input.note);
    if (noteIsEmpty(note)) throw new ActionError("handoff_note_required");
    const created = await createWorkTaskIn(tx, { teamId: team.id, projectId: null, title: input.title, description: describeNote(note, named(loaded)), requesterPersonId: actor.personId, dueDate: input.dueDate, clientId: loaded.work.clientId, channel: loaded.work.channel, contentFormat: loaded.work.contentFormat }, actor.personId, { notify: false });
    await sendToTriage(tx, created.task.id, "handoff", { actorPersonId: actor.personId });
    await tx.insert(schema.workTaskDependency).values({ blockerTaskId: taskId, blockedTaskId: created.task.id, type: "relates", createdByPersonId: actor.personId }).onConflictDoNothing();
    const [handoff] = await tx.insert(schema.workHandoff).values({ taskId, kind: "cross_team", fromPersonId: actor.personId, toTeamId: team.id, fromStateId: loaded.work.stateId, note, status: "pending", targetTaskId: created.task.id, createdByPersonId: actor.personId }).returning();
    await logActivity(tx, taskId, actor.personId, [{ type: "handoff_sent_team", to: { id: created.task.id, name: `${created.key} · ${team.name}` } }]);
    await logActivity(tx, created.task.id, actor.personId, [{ type: "handoff_received_team", from: { id: taskId, name: named(loaded) } }]);
    return { handoff, loaded, target: { id: created.task.id, key: created.key } };
  });
}

/**
 * The note in the receiving task's brief, so triage reads it without opening anything else. The
 * section names are stored in the task's description, so they are written once in the company's
 * language, from the messages — never as literals here.
 */
function describeNote(note: Note, from: string): string {
  const label = createTranslator({ locale: "vi", messages: vi, namespace: "work.handoff.note" });
  const parts: [string, string | undefined][] = [
    ["↪", from],
    [label("context"), note.context],
    [label("state"), note.state],
    [label("done"), note.done],
    [label("next"), note.next],
    [label("questions"), note.questions],
    [label("contacts"), note.contacts],
    [label("links"), note.links?.join("\n")],
  ];
  return parts
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n\n")
    .slice(0, 10000);
}

// ── Account handover (FR-PJM-46) ────────────────────────────────────────────────────────────

export type AccountHandoverResult = { before: string | null; after: string; projects: { id: string; name: string }[]; skipped: { id: string; name: string }[]; /** Open projects the actor may not run: left as they were, and not named. */ withheld: number; handoff: HandoffRow };

/**
 * A client's relationship changes hands with a note: the client's account manager, and the
 * `account_manager` role on its open projects (the member role is what grants the rights; the
 * project layer's own column follows it). A project whose lead is the new manager keeps its lead
 * and is named back — a lead is not also its own account manager (FR-PJM-14).
 *
 * The role is a door into each project, so it moves only where the actor may run the project
 * (`canManageProject`): a private project — or one of another entity — keeps its account manager
 * and is only counted, never named. The new manager is an employee who has not left: an outside
 * collaborator does not own a client relationship.
 */
export async function changeAccountManager(clientId: string, input: { toPersonId: string; note: Note }, actor: Actor, viewer: WorkViewer): Promise<AccountHandoverResult> {
  const result = await db().transaction(async (tx) => {
    const [client] = await tx.select().from(schema.workClient).where(eq(schema.workClient.id, clientId)).limit(1);
    if (!client) throw new ActionError("client_not_found");
    const note = normalizeNote(input.note);
    if (noteIsEmpty(note)) throw new ActionError("handoff_note_required");
    const to = await activePerson(tx, input.toPersonId);
    if (to.workforceType === "collaborator") throw new ActionError("account_manager_ineligible");
    if (client.accountManagerPersonId === to.id) throw new ActionError("account_manager_unchanged");
    await tx.update(schema.workClient).set({ accountManagerPersonId: to.id, updatedAt: new Date() }).where(eq(schema.workClient.id, clientId));

    const rows = await tx.select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)).where(and(eq(schema.workProject.clientId, clientId), notInArray(schema.workProject.status, ["done", "archived"])));
    const moved: { id: string; name: string }[] = [];
    const skipped: { id: string; name: string }[] = [];
    let withheld = 0;
    for (const row of rows) {
      const project = { id: row.project.id, name: row.project.name };
      if (!canManageProject(viewer, projectFacts(row.project, row.team))) {
        withheld += 1;
        continue;
      }
      const members = await tx.select().from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, project.id));
      const current = members.find((member) => member.personId === to.id);
      if (current?.role === "lead") {
        skipped.push(project);
        continue;
      }
      // Whoever held the role stays in the project as a member: they may still work in it.
      for (const member of members) if (member.role === "account_manager" && member.personId !== to.id) await tx.update(schema.workProjectMember).set({ role: "member" }).where(eq(schema.workProjectMember.id, member.id));
      if (current) await tx.update(schema.workProjectMember).set({ role: "account_manager" }).where(eq(schema.workProjectMember.id, current.id));
      else await tx.insert(schema.workProjectMember).values({ projectId: project.id, personId: to.id, role: "account_manager" });
      moved.push(project);
    }
    const [handoff] = await tx.insert(schema.workHandoff).values({ kind: "account", clientId, fromPersonId: client.accountManagerPersonId, toPersonId: to.id, note, status: "recorded", sourceRef: { clientId }, createdByPersonId: actor.personId }).returning();
    return { before: client.accountManagerPersonId, after: to.id, projects: moved, skipped, withheld, handoff };
  });
  await Promise.all([invalidateWorkClients(), invalidateWorkDirectory()]);
  return result;
}

export type AccountHandoffView = { id: string; fromName: string | null; toName: string | null; byName: string | null; note: Note; createdAt: Date };

/** A client's account handovers, newest first — the relationship's own history. */
export async function listAccountHandoffs(clientIds: readonly string[]): Promise<Map<string, AccountHandoffView[]>> {
  if (clientIds.length === 0) return new Map();
  const from = alias(schema.person, "from_person");
  const to = alias(schema.person, "to_person");
  const by = alias(schema.person, "by_person");
  const rows = await db()
    .select({ id: schema.workHandoff.id, clientId: schema.workHandoff.clientId, fromName: from.fullName, toName: to.fullName, byName: by.fullName, note: schema.workHandoff.note, createdAt: schema.workHandoff.createdAt })
    .from(schema.workHandoff)
    .leftJoin(from, eq(from.id, schema.workHandoff.fromPersonId))
    .leftJoin(to, eq(to.id, schema.workHandoff.toPersonId))
    .leftJoin(by, eq(by.id, schema.workHandoff.createdByPersonId))
    .where(and(eq(schema.workHandoff.kind, "account"), inArray(schema.workHandoff.clientId, [...clientIds])))
    .orderBy(desc(schema.workHandoff.createdAt));
  const result = new Map<string, AccountHandoffView[]>();
  for (const { clientId, ...row } of rows) if (clientId) result.set(clientId, [...(result.get(clientId) ?? []), row]);
  return result;
}

// ── Reading: a task's hand-offs (FR-PJM-43) ─────────────────────────────────────────────────

export type HandoffView = {
  id: string;
  kind: string;
  status: HandoffStatus;
  fromPersonId: string | null;
  fromName: string | null;
  toPersonId: string | null;
  toName: string | null;
  toTeamName: string | null;
  fromStateName: string | null;
  toStateName: string | null;
  packageName: string | null;
  packageFields: PackageField[];
  packageValues: Record<string, string>;
  checklist: { id: string; text: string; done: boolean }[];
  fileId: string | null;
  note: Note;
  returnReason: string | null;
  respondedByName: string | null;
  createdAt: Date;
  respondedAt: Date | null;
  /** A cross-team hand-off: the receiving task as it stands now — its key and title only if the viewer may open it. */
  target: { id: string; key: string | null; title: string | null; stateName: string; status: string; triageStatus: string | null } | null;
};

export async function listTaskHandoffs(taskId: string, viewer: WorkViewer): Promise<HandoffView[]> {
  const from = alias(schema.person, "from_person");
  const to = alias(schema.person, "to_person");
  const responder = alias(schema.person, "responder");
  const fromState = alias(schema.workState, "from_state");
  const toState = alias(schema.workState, "to_state");
  const rows = await db()
    .select({ handoff: schema.workHandoff, fromName: from.fullName, toName: to.fullName, respondedByName: responder.fullName, toTeamName: schema.workTeam.name, fromStateName: fromState.name, toStateName: toState.name, packageName: schema.workHandoffPackage.name, packageFields: schema.workHandoffPackage.fields })
    .from(schema.workHandoff)
    .leftJoin(from, eq(from.id, schema.workHandoff.fromPersonId))
    .leftJoin(to, eq(to.id, schema.workHandoff.toPersonId))
    .leftJoin(responder, eq(responder.id, schema.workHandoff.respondedByPersonId))
    .leftJoin(schema.workTeam, eq(schema.workTeam.id, schema.workHandoff.toTeamId))
    .leftJoin(fromState, eq(fromState.id, schema.workHandoff.fromStateId))
    .leftJoin(toState, eq(toState.id, schema.workHandoff.toStateId))
    .leftJoin(schema.workHandoffPackage, eq(schema.workHandoffPackage.id, schema.workHandoff.packageId))
    .where(eq(schema.workHandoff.taskId, taskId))
    .orderBy(desc(schema.workHandoff.createdAt));
  const targets = await loadTasks(rows.map((row) => row.handoff.targetTaskId).filter((id): id is string => !!id));
  const targetStates = targets.size ? await db().select({ id: schema.workState.id, name: schema.workState.name }).from(schema.workState).where(inArray(schema.workState.id, [...targets.values()].map((row) => row.work.stateId))) : [];
  return rows.map(({ handoff, packageFields, ...names }) => {
    const target = handoff.targetTaskId ? targets.get(handoff.targetTaskId) : undefined;
    const visible = target && canViewTask(viewer, target.facts);
    return {
      id: handoff.id,
      kind: handoff.kind,
      status: handoff.status as HandoffStatus,
      fromPersonId: handoff.fromPersonId,
      toPersonId: handoff.toPersonId,
      packageFields: packageFields ?? [],
      packageValues: handoff.packageValues,
      checklist: handoff.checklist,
      fileId: handoff.fileId,
      note: handoff.note,
      returnReason: handoff.returnReason,
      createdAt: handoff.createdAt,
      respondedAt: handoff.respondedAt,
      ...names,
      // The sender follows the receiving task's progress (FR-PJM-42) — its state at least, even
      // where they may not open the other team's task.
      target: target ? { id: target.task.id, key: visible ? keyOf(target) : null, title: visible ? target.task.title : null, stateName: targetStates.find((state) => state.id === target.work.stateId)?.name ?? "", status: target.task.status, triageStatus: target.work.triageStatus } : null,
    };
  });
}

/** Pending hand-offs addressed to a person, with the task — for "My work" (Today reads day-feed's). */
export async function listPendingHandoffsFor(personId: string): Promise<{ id: string; taskId: string; key: string; title: string; kind: string; fromName: string | null; createdAt: Date; note: Note }[]> {
  const rows = await db()
    .select({ id: schema.workHandoff.id, taskId: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, kind: schema.workHandoff.kind, fromName: schema.person.fullName, createdAt: schema.workHandoff.createdAt, note: schema.workHandoff.note })
    .from(schema.workHandoff)
    .innerJoin(schema.task, and(eq(schema.task.id, schema.workHandoff.taskId), isNull(schema.task.deletedAt)))
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .leftJoin(schema.person, eq(schema.person.id, schema.workHandoff.fromPersonId))
    .where(and(eq(schema.workHandoff.toPersonId, personId), eq(schema.workHandoff.status, "pending"), ne(schema.workHandoff.kind, "cross_team")))
    .orderBy(asc(schema.workHandoff.createdAt));
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number) }));
}

// ── Statistics (FR-PJM-41, for the delivery dashboards of FR-PJM-60) ────────────────────────

export type StageHandoffStats = { teamId: string; toStateId: string | null; stateName: string | null; total: number; returned: number; pending: number; /** Mean minutes from hand-off to answer, over the answered ones. */ avgWaitMinutes: number | null; /** The longest a pending one has waited so far. */ oldestPendingMinutes: number | null };

/**
 * Per team and stage (the state handed into), since a moment: how many hand-offs, how many came
 * back, how many still wait, and how long answers take. One aggregate query; no rights inside —
 * the caller names teams it may report on.
 */
export async function handoffStatsByStage(teamIds: readonly string[], since: Date): Promise<StageHandoffStats[]> {
  if (teamIds.length === 0) return [];
  const rows = await db()
    .select({
      teamId: schema.workTask.teamId,
      toStateId: schema.workHandoff.toStateId,
      stateName: schema.workState.name,
      total: sql<number>`count(*)::int`,
      returned: sql<number>`count(*) filter (where ${schema.workHandoff.status} = 'returned')::int`,
      pending: sql<number>`count(*) filter (where ${schema.workHandoff.status} = 'pending')::int`,
      avgWaitMinutes: sql<number | null>`round(avg(extract(epoch from (${schema.workHandoff.respondedAt} - ${schema.workHandoff.createdAt})) / 60) filter (where ${schema.workHandoff.respondedAt} is not null))::int`,
      oldestPendingMinutes: sql<number | null>`round(max(extract(epoch from (now() - ${schema.workHandoff.createdAt})) / 60) filter (where ${schema.workHandoff.status} = 'pending'))::int`,
    })
    .from(schema.workHandoff)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.workHandoff.taskId))
    .leftJoin(schema.workState, eq(schema.workState.id, schema.workHandoff.toStateId))
    .where(and(eq(schema.workHandoff.kind, "stage"), inArray(schema.workTask.teamId, [...teamIds]), gte(schema.workHandoff.createdAt, since)))
    .groupBy(schema.workTask.teamId, schema.workHandoff.toStateId, schema.workState.name, schema.workState.sortOrder)
    .orderBy(asc(schema.workState.sortOrder));
  return rows.map((row) => ({ ...row, total: Number(row.total), returned: Number(row.returned), pending: Number(row.pending), avgWaitMinutes: row.avgWaitMinutes === null ? null : Number(row.avgWaitMinutes), oldestPendingMinutes: row.oldestPendingMinutes === null ? null : Number(row.oldestPendingMinutes) }));
}

/** Returned hand-offs per task — the quality signal a close-out report and the task page show. */
export async function handoffReturnsByTask(taskIds: readonly string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db()
    .select({ taskId: schema.workHandoff.taskId, returned: sql<number>`count(*)::int` })
    .from(schema.workHandoff)
    .where(and(inArray(schema.workHandoff.taskId, [...taskIds]), eq(schema.workHandoff.status, "returned")))
    .groupBy(schema.workHandoff.taskId);
  return new Map(rows.flatMap((row) => (row.taskId ? [[row.taskId, Number(row.returned)] as [string, number]] : [])));
}
