// Value lists shared by the server and the forms. Plain module: never "use client".

export const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

// Who an announcement is for. The same one-text-key scheme as the knowledge base, plus the
// branch (location, FR-COM-01); no roles — an announcement goes to places and people.
// `unit` means that org unit and everything below it; `unit_only` stops at the unit itself
// (FR-KB-14), which is how a head narrows a notice to their own people.
export const AUDIENCE_TYPES = ["all", "entity", "unit", "unit_only", "branch", "person"] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const audienceKey = (type: AudienceType, id?: string | null): string => (type === "all" ? "all" : `${type}:${(id ?? "").toLowerCase()}`);

export function parseAudienceKey(key: string): { type: AudienceType; id: string | null } | null {
  if (key === "all") return { type: "all", id: null };
  const at = key.indexOf(":");
  if (at < 0) return null;
  const type = key.slice(0, at) as AudienceType;
  const id = key.slice(at + 1);
  if (type === "all" || !(AUDIENCE_TYPES as readonly string[]).includes(type)) return null;
  return UUID.test(id) ? { type, id: id.toLowerCase() } : null;
}

/** draft / scheduled / live / expired / archived — what a manager sees; readers only ever see "live". */
export const ANNOUNCEMENT_PHASES = ["draft", "scheduled", "live", "expired", "archived"] as const;
export type AnnouncementPhase = (typeof ANNOUNCEMENT_PHASES)[number];

export const KUDOS_MESSAGE_MAX = 500;
