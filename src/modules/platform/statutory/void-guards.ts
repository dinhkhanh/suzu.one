// Void guards: what a module that relies on statutory values may refuse about voiding one
// (PAY-13). A wrong approved version may be taken back — but not once something that cannot be
// undone was worked out from it: a payroll run already paid, a filing already made. The statutory
// store is the platform's and must not learn of payroll, so payroll registers its guard here and
// `voidParameter` asks every guard inside the transaction that voids the version.
//
// Like the project guards: no "server-only" and no database import; modules register at load
// time beside their tables, a guard's code loads lazily the first time it is asked, and the
// registry sits on `globalThis` so the several copies of this module a server build may hold share
// one list.

/**
 * `tx` is the transaction voiding the version (typed loosely: the platform's database types are
 * not imported here). null lets the void through; a string is the refusal's message key.
 */
export type ParameterVoidGuard = (tx: unknown, versionId: string) => Promise<string | null>;

type Loader = () => Promise<ParameterVoidGuard>;
const KEY = Symbol.for("suzu.parameter-void-guards");
const registry = (): Map<string, Loader> => ((globalThis as Record<symbol, Map<string, Loader> | undefined>)[KEY] ??= new Map());

/** Registers a guard under a name; a second registration of the name replaces the first. */
export function registerParameterVoidGuard(name: string, load: Loader): void {
  registry().set(name, load);
}

export const registeredParameterVoidGuards = (): string[] => [...registry().keys()];

/** Every guard's answer, in registration order; the first refusal wins. */
export async function checkParameterVoid(tx: unknown, versionId: string): Promise<string | null> {
  for (const load of registry().values()) {
    const refusal = await (await load())(tx, versionId);
    if (refusal) return refusal;
  }
  return null;
}
