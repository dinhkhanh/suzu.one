// Feature flags: pilot a module with one department or entity, then open it to the group
// (development plan §1 and §5). Pure; no I/O. Add a flag here when a module is ready to pilot.
//
// A flag only decides who *sees* a feature. It is never a permission: RBAC still decides what
// each person may do inside it.

export const FLAGS = ["people"] as const;
export type FlagKey = (typeof FLAGS)[number];

export type Rollout = { enabledForAll: boolean; entityIds: readonly string[]; departmentIds: readonly string[]; personIds: readonly string[] };
export type FlagSubject = { personId: string | null; entityId: string | null; departmentId: string | null };

export const OFF: Rollout = { enabledForAll: false, entityIds: [], departmentIds: [], personIds: [] };

export function isEnabled(rollout: Rollout | undefined, subject: FlagSubject): boolean {
  if (!rollout) return false;
  return (
    rollout.enabledForAll ||
    (!!subject.personId && rollout.personIds.includes(subject.personId)) ||
    (!!subject.entityId && rollout.entityIds.includes(subject.entityId)) ||
    (!!subject.departmentId && rollout.departmentIds.includes(subject.departmentId))
  );
}
