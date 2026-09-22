// The hand-off gate on a workflow transition (FR-PJM-40): every change of a task's state goes
// through `updateWorkTaskIn` (tasks.ts), which asks here whether the move needs a package. If it
// does, the move is refused with everything the hand-off sheet needs to open at once — the
// package, who may receive the task, the task's files — so the screen never fails silently.
// Kept apart from handoffs.ts so tasks.ts can import it without importing itself back.
import "server-only";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { defaultReceiver, packageFor, type PackageCheck, type PackageField } from "./engine/handoff";

type Executor = Tx | ReturnType<typeof db>;
export type HandoffPackageRow = typeof schema.workHandoffPackage.$inferSelect;

/** What the hand-off sheet opens with. Plain data: it travels in the refusal to the browser. */
export type HandoffRequirement = {
  taskId: string;
  taskKey: string;
  taskTitle: string;
  fromStateId: string;
  fromStateName: string;
  toStateId: string;
  toStateName: string;
  package: { id: string; name: string; fields: PackageField[]; checklist: PackageCheck[]; requireLink: boolean; requireFile: boolean; requireAccept: boolean };
  receivers: { id: string; fullName: string }[];
  defaultReceiverId: string | null;
  files: { id: string; fileName: string }[];
};

/** A team's packages, oldest first (the order `packageFor` breaks ties in). */
export async function listPackages(teamId: string, executor: Executor = db()): Promise<HandoffPackageRow[]> {
  return executor.select().from(schema.workHandoffPackage).where(eq(schema.workHandoffPackage.teamId, teamId)).orderBy(asc(schema.workHandoffPackage.createdAt), asc(schema.workHandoffPackage.id));
}

export async function findPackageFor(executor: Executor, teamId: string, fromStateId: string, toStateId: string): Promise<HandoffPackageRow | null> {
  return packageFor(await listPackages(teamId, executor), fromStateId, toStateId);
}

/**
 * The stage's own assignee: a team automation that assigns whoever enters the state (FR-PJM-33).
 * The first active one wins; none = the sheet asks.
 */
async function stageAssignee(executor: Executor, teamId: string, toStateId: string): Promise<string | null> {
  const rules = await executor.select({ trigger: schema.workAutomation.trigger, actions: schema.workAutomation.actions }).from(schema.workAutomation).where(and(eq(schema.workAutomation.teamId, teamId), eq(schema.workAutomation.isActive, true))).orderBy(asc(schema.workAutomation.createdAt));
  for (const rule of rules) {
    if (rule.trigger.type !== "state_entered" || rule.trigger.stateId !== toStateId) continue;
    const assign = rule.actions.find((action) => action.type === "assign" && action.personId);
    if (assign?.personId) return assign.personId;
  }
  return null;
}

/** Who may receive the task: the team's and the project's people who have not left (as `listAssignable`). */
async function receiversOf(executor: Executor, teamId: string, projectId: string | null): Promise<{ id: string; fullName: string }[]> {
  const inTeam = executor.select({ id: schema.workTeamMember.personId }).from(schema.workTeamMember).where(eq(schema.workTeamMember.teamId, teamId));
  const inProject = projectId ? executor.select({ id: schema.workProjectMember.personId }).from(schema.workProjectMember).where(eq(schema.workProjectMember.projectId, projectId)) : null;
  const [team, project] = await Promise.all([inTeam, inProject ?? Promise.resolve([] as { id: string }[])]);
  const ids = [...new Set([...team, ...project].map((row) => row.id))];
  if (ids.length === 0) return [];
  const people = await executor
    .select({ id: schema.person.id, fullName: schema.person.fullName, searchName: schema.person.searchName })
    .from(schema.person)
    .where(and(inArray(schema.person.id, ids), ne(schema.person.status, "offboarded")));
  return people.sort((a, b) => a.searchName.localeCompare(b.searchName)).map(({ id, fullName }) => ({ id, fullName }));
}

type GateTask = { task: { id: string; title: string; assigneePersonId: string | null }; work: { teamId: string; projectId: string | null; stateId: string; number: number }; team: { key: string } };

/** null = the move needs no package. */
export async function requirementFor(executor: Executor, loaded: GateTask, toStateId: string, actorPersonId: string | null): Promise<HandoffRequirement | null> {
  const pkg = await findPackageFor(executor, loaded.work.teamId, loaded.work.stateId, toStateId);
  if (!pkg) return null;
  // Read in the caller's transaction: the gate runs inside the move it may refuse.
  const [states, receivers, files, stage] = await Promise.all([
    executor.select({ id: schema.workState.id, name: schema.workState.name }).from(schema.workState).where(eq(schema.workState.teamId, loaded.work.teamId)),
    receiversOf(executor, loaded.work.teamId, loaded.work.projectId),
    executor
      .select({ id: schema.storedFile.id, fileName: schema.storedFile.fileName })
      .from(schema.storedFile)
      .where(and(eq(schema.storedFile.ownerType, "work_task"), eq(schema.storedFile.ownerId, loaded.task.id), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt)))
      .orderBy(asc(schema.storedFile.createdAt)),
    stageAssignee(executor, loaded.work.teamId, toStateId),
  ]);
  const nameOf = (id: string) => states.find((state) => state.id === id)?.name ?? "";
  return {
    taskId: loaded.task.id,
    taskKey: `${loaded.team.key}-${loaded.work.number}`,
    taskTitle: loaded.task.title,
    fromStateId: loaded.work.stateId,
    fromStateName: nameOf(loaded.work.stateId),
    toStateId,
    toStateName: nameOf(toStateId),
    package: { id: pkg.id, name: pkg.name, fields: pkg.fields, checklist: pkg.checklist, requireLink: pkg.requireLink, requireFile: pkg.requireFile, requireAccept: pkg.requireAccept },
    receivers: receivers.filter((person) => person.id !== actorPersonId),
    defaultReceiverId: defaultReceiver(stage, actorPersonId),
    files,
  };
}
