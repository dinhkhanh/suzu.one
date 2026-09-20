// Value lists shared by the server and the forms. Plain module: never "use client".
import { ROLES } from "../platform/rbac/roles";

export const SPACE_KINDS = ["open", "controlled"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const ACCESS_LEVELS = ["view", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const PAGE_STATUSES = ["draft", "in_review", "published", "archived"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

// Who an access row (and, from week 2, an acknowledgement audience) names. One text key per
// subject — "all", "entity:<uuid>", "role:hr_staff"… — so a list query can filter with `IN (keys)`.
export const SUBJECT_TYPES = ["all", "entity", "department", "team", "role", "person"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const subjectKey = (type: SubjectType, id?: string | null): string => (type === "all" ? "all" : `${type}:${id ?? ""}`);

export function parseSubjectKey(key: string): { type: SubjectType; id: string | null } | null {
  if (key === "all") return { type: "all", id: null };
  const at = key.indexOf(":");
  if (at < 0) return null;
  const type = key.slice(0, at) as SubjectType;
  const id = key.slice(at + 1);
  if (type === "role") return (ROLES as readonly string[]).includes(id) ? { type, id } : null;
  if (type === "entity" || type === "department" || type === "team" || type === "person") return UUID.test(id) ? { type, id: id.toLowerCase() } : null;
  return null;
}

export const SPACE_KEY = /^[a-z0-9][a-z0-9-]{1,39}$/;
