// Leave-change hooks: what else must be brought in line the moment a leave request is filed,
// amended, decided or called off. Leave is an older module than work management, whose leave cover
// (FR-PJM-44) is drafted from leave requests: leave cannot import work (older modules never learn
// of newer ones, and work already reads leave), so the newer module registers a hook here and the
// leave actions run every hook once their own change has committed. Until then the cover plan of a
// request filed today existed only after the night's job, and its approver saw none.
//
// Like the completion guards and the project-creation hooks: no "server-only" and no database
// import; modules register at load time beside their tables, the hook's code loads lazily when
// leave first changes, and the registry sits on `globalThis` so the several copies of this module a
// server build may hold share one list.

/** Whose leave changed. The hook reads the requests itself — it is told that something changed, not what. */
export type LeaveChange = { personId: string };

/** Runs after the leave change has committed, outside any transaction. */
export type LeaveChangeHook = (change: LeaveChange) => Promise<void>;

type Registry = Map<string, () => Promise<LeaveChangeHook>>;
const KEY = Symbol.for("suzu.leave-changes.hooks");
const registry = (): Registry => ((globalThis as Record<symbol, Registry | undefined>)[KEY] ??= new Map());

/** Registers a hook under a name; a second registration of the name replaces the first. */
export function registerLeaveChangeHook(name: string, load: () => Promise<LeaveChangeHook>): void {
  registry().set(name, load);
}

export const registeredLeaveChangeHooks = (): string[] => [...registry().keys()];

/**
 * Runs every hook, one after another in registration order. A hook that throws stops the rest and
 * the error reaches the caller — which has already committed the leave, and decides what a failed
 * follow-up is worth (the leave actions report it and carry on: a job makes up for it overnight).
 */
export async function runLeaveChangeHooks(change: LeaveChange): Promise<void> {
  for (const load of registry().values()) await (await load())(change);
}
