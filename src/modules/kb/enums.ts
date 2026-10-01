// Value lists shared by the server and the forms. Plain module: never "use client".
import { slugify } from "@/lib/slug";
import { ROLES } from "../platform/rbac/roles";

export const SPACE_KINDS = ["open", "controlled"] as const;
export type SpaceKind = (typeof SPACE_KINDS)[number];

export const ACCESS_LEVELS = ["view", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const PAGE_STATUSES = ["draft", "in_review", "published", "archived"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

// Who an access row (and an acknowledgement audience) names. One text key per subject — "all",
// "entity:<uuid>", "role:hr_staff"… — so a list query can filter with `IN (keys)`.
// `unit:<id>` is that org unit **and every unit below it** (FR-KB-14): the viewer carries one key
// per unit above them, so a row naming "Marketing" matches someone in "Marketing › Social"
// without the row knowing that team exists. `unit_only:<id>` is the deliberate narrowing — it
// matches only people whose own unit is that one.
//
// `project:<id>` is the people of one project (FR-PJM-31): its members in any role, its lead and
// the leads of its owning team, as they are *now* — a person added to the project reads its
// documents at once, one removed stops. It is not in `SUBJECT_TYPES` (the access form's list):
// the row is written when a project's document space is made, never picked by hand.
export const SUBJECT_TYPES = ["all", "entity", "unit", "unit_only", "role", "person"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number] | "project";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const subjectKey = (type: SubjectType, id?: string | null): string => (type === "all" ? "all" : `${type}:${id ?? ""}`);

export function parseSubjectKey(key: string): { type: SubjectType; id: string | null } | null {
  if (key === "all") return { type: "all", id: null };
  const at = key.indexOf(":");
  if (at < 0) return null;
  const type = key.slice(0, at) as SubjectType;
  const id = key.slice(at + 1);
  if (type === "role") return (ROLES as readonly string[]).includes(id) ? { type, id } : null;
  if (type === "entity" || type === "unit" || type === "unit_only" || type === "person" || type === "project") return UUID.test(id) ? { type, id: id.toLowerCase() } : null;
  return null;
}

export const SPACE_KEY = /^[a-z0-9][a-z0-9-]{1,39}$/;
/** What a space key is made of when nobody types one: "Sổ tay nhân viên" → "so-tay-nhan-vien". */
export const spaceKeyOf = (name: string): string => slugify(name, { maxLength: 40 });

// ── Page addresses ──────────────────────────────────────────────────────────────────────────
// A page lives at /kb/spaces/<space key>/<page slug>. The slug is made from the title and can be
// changed; it is unique in its space, and an old one still leads to the page.

export const PAGE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
/** The space's own addresses (/kb/spaces/<key>/new, /import): no page may take them. */
export const RESERVED_PAGE_SLUGS: readonly string[] = ["new", "import"];
/** A slug may be typed only if it reads as one — and never as a page id, which is looked up as an id. */
export const isPageSlug = (value: string): boolean => PAGE_SLUG.test(value) && !UUID.test(value) && !RESERVED_PAGE_SLUGS.includes(value);
export const pageSlugOf = (title: string): string => slugify(title, { maxLength: 80 }) || "trang";

/** Where a page is read. A page from before slugs is found by its id there too. */
export const pagePath = (spaceKey: string, page: { id: string; slug: string | null }): string => `/kb/spaces/${spaceKey}/${page.slug ?? page.id}`;
