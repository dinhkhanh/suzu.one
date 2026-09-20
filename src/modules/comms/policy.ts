// Who may post, read and track announcements, and give or remove kudos. Pure.
//
// Posting takes `comms:manage` over EVERY target of the audience: a department head announces to
// their department, an entity's HR to their entity, "all staff" takes a group-wide grant. Whoever
// could have posted it — and its author, while they still hold the permission anywhere — sees the
// read tracking. Readers see an announcement while it is live and its audience names them; like
// the knowledge base, a collaborator is nobody's "all staff" and is reached only by name.
import { can, type Principal, type Target } from "../platform/rbac/policy";
import { type AnnouncementPhase, type AnnouncementStatus, audienceKey } from "./enums";

export type CommsPlacement = { entityId: string | null; departmentId: string | null; teamId: string | null; branchId: string | null };
export type CommsViewer = { principal: Principal; personId: string; keys: readonly string[] };

export function commsViewerKeys(principal: Principal, placement: CommsPlacement): string[] {
  if (!principal.personId) return [];
  const own = audienceKey("person", principal.personId);
  if (principal.workforceType === "collaborator") return [own];
  return [
    "all",
    ...(placement.entityId ? [audienceKey("entity", placement.entityId)] : []),
    ...(placement.departmentId ? [audienceKey("department", placement.departmentId)] : []),
    ...(placement.teamId ? [audienceKey("team", placement.teamId)] : []),
    ...(placement.branchId ? [audienceKey("branch", placement.branchId)] : []),
    own,
  ];
}

/** One audience key with where it sits in the organisation; `target: null` = the key names nothing that exists. */
export type AudienceTarget = { key: string; target: Target | null };

export const canPostAnywhere = (principal: Principal): boolean => can(principal, "comms:manage");

export function canPostTo(principal: Principal, targets: readonly AudienceTarget[]): boolean {
  return targets.length > 0 && targets.every(({ target }) => !!target && can(principal, "comms:manage", target));
}

export type AnnouncementFacts = { status: AnnouncementStatus; publishAt: Date | null; expiresAt: Date | null; authorPersonId: string };

export function phaseOf(row: Pick<AnnouncementFacts, "status" | "publishAt" | "expiresAt">, now: Date): AnnouncementPhase {
  if (row.status === "draft") return "draft";
  if (row.status === "archived") return "archived";
  if (!row.publishAt || row.publishAt > now) return "scheduled";
  if (row.expiresAt && row.expiresAt <= now) return "expired";
  return "live";
}

/** Edit, publish, archive, pin, and the read report. */
export function canManageAnnouncement(principal: Principal, row: Pick<AnnouncementFacts, "authorPersonId">, targets: readonly AudienceTarget[]): boolean {
  if (canPostTo(principal, targets)) return true;
  return !!principal.personId && principal.personId === row.authorPersonId && canPostAnywhere(principal);
}

export function canReadAnnouncement(viewer: CommsViewer, row: AnnouncementFacts, audienceKeys: readonly string[], now: Date): boolean {
  return phaseOf(row, now) === "live" && audienceKeys.some((key) => viewer.keys.includes(key));
}

// ── Kudos ───────────────────────────────────────────────────────────────────────────────────

export type KudosRecipient = Target & { personId: string; status: string; workforceType: string | null };

/** Staff thank staff: not oneself, not someone who has left, and collaborators neither give nor receive (they have no directory). */
export function canGiveKudos(principal: Principal, to: KudosRecipient): boolean {
  if (!principal.personId || principal.workforceType === "collaborator") return false;
  return to.personId !== principal.personId && to.status === "active" && to.workforceType !== "collaborator";
}

export function canRemoveKudos(principal: Principal, kudos: { fromPersonId: string }, to: Target): boolean {
  return (!!principal.personId && kudos.fromPersonId === principal.personId) || can(principal, "comms:manage", to);
}
