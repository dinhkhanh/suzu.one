// Pure rules for effective-dated parameter versions. No I/O.
import { addDays, type IsoDate } from "@/lib/dates";

export type Version = { id: string; validFrom: IsoDate; validTo: IsoDate | null };

/** The version in force on `date`, if any. `validTo` is inclusive. */
export function versionOn<V extends Version>(versions: readonly V[], date: IsoDate): V | undefined {
  return versions.find((version) => version.validFrom <= date && (version.validTo === null || version.validTo >= date));
}

export type ApprovalPlan =
  // Nothing to close: there is no version yet, or the latest one has already ended.
  | { kind: "first" }
  // The new version takes over from the open one, which ends the day before.
  | { kind: "succeed"; closeId: string; closeOn: IsoDate }
  | { kind: "rejected"; reason: "version_exists" | "before_current_version" };

/**
 * What approving a version starting on `validFrom` does to the approved versions already there.
 * History is never rewritten: a new version can only start after the current one did.
 */
export function planApproval(approved: readonly Version[], validFrom: IsoDate): ApprovalPlan {
  if (approved.length === 0) return { kind: "first" };
  const latest = approved.reduce((a, b) => (a.validFrom >= b.validFrom ? a : b));
  if (validFrom === latest.validFrom) return { kind: "rejected", reason: "version_exists" };
  if (validFrom < latest.validFrom) return { kind: "rejected", reason: "before_current_version" };
  // The latest version was given an end: a new one may start once that end has passed.
  if (latest.validTo !== null) return validFrom > latest.validTo ? { kind: "first" } : { kind: "rejected", reason: "before_current_version" };
  return { kind: "succeed", closeId: latest.id, closeOn: addDays(validFrom, -1) };
}
