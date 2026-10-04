// Project guards: what a newer module may refuse about a project the work module is about to
// change. A project is the work module's row; the project layer (Phase 10) hangs the kick-off gate
// and the close-out off it, and both are walked around if work sets any status it is asked for
// (FR-PJM-03, 59). Work cannot import projects (older modules never learn of newer ones), so the
// newer module registers its guards here and work asks them inside the transaction that makes the
// change:
//
//   · a **status guard** before a project's status category changes — it may refuse (a client
//     project becomes Active only through its kick-off and Done only through its close-out), or,
//     when a project is brought back from the archive, say which category it returns to (a closed
//     project comes back closed, never active);
//   · a **work guard** before work is added to a project — a new task, a task's state change, a
//     time entry — which a closed project refuses until it is re-opened.
//
// Like the completion guards and the project-creation hooks: no "server-only" and no database
// import; modules register at load time beside their tables, a guard's code loads lazily the first
// time it is asked, and the registry sits on `globalThis` so the several copies of this module a
// server build may hold share one list.

/** Why a guard refused: a message key for the screen and plain data it may show. */
export type ProjectRefusal = { reason: string; details?: unknown };

/** `from` and `to` are status categories (planned | active | paused | done | archived). */
export type ProjectStatusChange = {
  projectId: string;
  from: string;
  to: string;
  /** The project is being brought back from the archive: `to` is only where work would put it. */
  restoring: boolean;
};

/**
 * `tx` is the transaction changing the project (typed loosely: the platform's database types are
 * not imported here). null lets the change through as asked; `refusal` stops it; `to` — honoured
 * only when restoring — names the category the project takes instead.
 */
export type ProjectStatusGuard = (tx: unknown, change: ProjectStatusChange) => Promise<{ refusal: ProjectRefusal } | { to: string } | null>;

export const PROJECT_WORK_ACTIONS = ["task_create", "task_state", "time_entry"] as const;
export type ProjectWorkAction = (typeof PROJECT_WORK_ACTIONS)[number];
export type ProjectWork = { projectId: string; action: ProjectWorkAction };

/** null lets the work in. */
export type ProjectWorkGuard = (tx: unknown, work: ProjectWork) => Promise<ProjectRefusal | null>;

type Loader<Guard> = () => Promise<Guard>;
type Registry = { status: Map<string, Loader<ProjectStatusGuard>>; work: Map<string, Loader<ProjectWorkGuard>> };
const KEY = Symbol.for("suzu.project-guards");
const registry = (): Registry => ((globalThis as Record<symbol, Registry | undefined>)[KEY] ??= { status: new Map(), work: new Map() });

/** Registers a guard under a name; a second registration of the name replaces the first. */
export function registerProjectStatusGuard(name: string, load: Loader<ProjectStatusGuard>): void {
  registry().status.set(name, load);
}

export function registerProjectWorkGuard(name: string, load: Loader<ProjectWorkGuard>): void {
  registry().work.set(name, load);
}

export const registeredProjectGuards = (): { status: string[]; work: string[] } => ({ status: [...registry().status.keys()], work: [...registry().work.keys()] });

/**
 * Every status guard's answer, in registration order. The first refusal wins. Otherwise `to` is the
 * category the project takes: the one asked for, or — when restoring — the one a guard named (each
 * later guard is asked about that one).
 */
export async function checkProjectStatusChange(tx: unknown, change: ProjectStatusChange): Promise<{ refusal: ProjectRefusal | null; to: string }> {
  let to = change.to;
  for (const load of registry().status.values()) {
    const answer = await (await load())(tx, { ...change, to });
    if (!answer) continue;
    if ("refusal" in answer) return { refusal: answer.refusal, to };
    if (change.restoring) to = answer.to;
  }
  return { refusal: null, to };
}

/** Every work guard's answer; the first refusal wins (in registration order). */
export async function checkProjectWork(tx: unknown, work: ProjectWork): Promise<ProjectRefusal | null> {
  for (const load of registry().work.values()) {
    const refusal = await (await load())(tx, work);
    if (refusal) return refusal;
  }
  return null;
}
