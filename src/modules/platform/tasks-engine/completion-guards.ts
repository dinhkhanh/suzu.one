// Completion guards: a feature module may refuse that a task of the engine be marked done — the
// work handover step of an offboarding checklist cannot close while the leaver still owns work
// (FR-PJM-45). The platform cannot import feature modules, so they register here instead, and
// `setTaskStatus` asks every guard before a task becomes done.
//
// No "server-only" and no database import: modules register at load time from files that are also
// read by tooling (work registers beside its tables, which every database access loads), and a
// guard's own check is loaded lazily when it first runs. The registry sits on `globalThis` so the
// several copies of this module a server build may hold (one per bundle layer) share one list.

/** Why a guard refused: a message key for the screen and plain data it may show. */
export type CompletionRefusal = { reason: string; details?: unknown };

export type GuardedTask = { id: string; kind: string; contextType: string | null; contextId: string | null; subjectPersonId: string | null };

/**
 * `executor` is the transaction completing the task (typed loosely: the platform's database types
 * are not imported here). Return null to let the task close.
 */
export type CompletionGuard = (executor: unknown, task: GuardedTask) => Promise<CompletionRefusal | null>;

type Registry = Map<string, () => Promise<CompletionGuard>>;
const KEY = Symbol.for("suzu.tasks-engine.completion-guards");
const registry = (): Registry => ((globalThis as Record<symbol, Registry | undefined>)[KEY] ??= new Map());

/**
 * Registers a guard under a name (registering a name twice keeps the last one, so a module loaded
 * again during development does not add a second copy). `load` returns the guard, typically through
 * a dynamic import, so registering costs nothing until a task is completed.
 */
export function registerCompletionGuard(name: string, load: () => Promise<CompletionGuard>): void {
  registry().set(name, load);
}

export const registeredCompletionGuards = (): string[] => [...registry().keys()];

/** Every guard's answer; the first refusal wins (in registration order). */
export async function checkCompletion(executor: unknown, task: GuardedTask): Promise<CompletionRefusal | null> {
  for (const load of registry().values()) {
    const refusal = await (await load())(executor, task);
    if (refusal) return refusal;
  }
  return null;
}
