// Project-creation hooks: what else must exist from the moment a project does. A project is the
// work module's row, and the project layer (Phase 10) hangs its plan — the type, the job number —
// off it. Work cannot import projects (older modules never learn of newer ones), so the newer
// module registers a hook here and work runs every hook inside the transaction that makes the
// project: whichever way a project is created — the form, a template, a deal won in the CRM, an
// import — it is committed with everything the hooks add, or not at all.
//
// Like the completion guards: no "server-only" and no database import; modules register at load
// time beside their tables, the hook's code loads lazily when a project is first created, and the
// registry sits on `globalThis` so the several copies of this module a server build may hold share
// one list.

/** The project that was just inserted. */
export type CreatedProject = { id: string };

/**
 * `tx` is the transaction creating the project (typed loosely: the platform's database types are
 * not imported here). A hook that throws rolls the project back with it.
 */
export type ProjectCreationHook = (tx: unknown, project: CreatedProject) => Promise<void>;

type Registry = Map<string, () => Promise<ProjectCreationHook>>;
const KEY = Symbol.for("suzu.project-creation.hooks");
const registry = (): Registry => ((globalThis as Record<symbol, Registry | undefined>)[KEY] ??= new Map());

/** Registers a hook under a name; a second registration of the name replaces the first. */
export function registerProjectCreationHook(name: string, load: () => Promise<ProjectCreationHook>): void {
  registry().set(name, load);
}

export const registeredProjectCreationHooks = (): string[] => [...registry().keys()];

/** Runs every hook, one after another in registration order: they share one transaction. */
export async function runProjectCreationHooks(tx: unknown, project: CreatedProject): Promise<void> {
  for (const load of registry().values()) await (await load())(tx, project);
}
