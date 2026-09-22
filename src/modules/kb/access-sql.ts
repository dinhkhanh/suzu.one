// The knowledge-base policy as WHERE clauses, so lists, trees and search never load what the
// viewer may not see and then throw it away. Conditions refer to `kb_space` and `kb_page` by
// their table names: the query must select from (or join) them un-aliased.
// kb.test.ts checks every clause against the pure policy for a grid of viewers and pages.
import "server-only";
import { and, inArray, isNotNull, isNull, ne, or, type SQL, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import { entityReach, permissionReach } from "../platform/rbac/policy";
import type { KbViewer } from "./policy";

const { kbAccess, kbPage, kbSpace } = schema;
const NEVER = sql`false`;
const either = (...conditions: SQL[]): SQL => or(...conditions) ?? NEVER;
const both = (...conditions: SQL[]): SQL => and(...conditions) ?? NEVER;

/**
 * Who runs a space: `kb:manage` over its entity, or `kb:manage_unit` over the unit that owns it —
 * a unit grant already carries its whole subtree, so a head's own unit and everything below it
 * are one `IN` list (FR-KB-13).
 */
export function spaceManagedSql(viewer: KbViewer): SQL {
  const reach = entityReach(viewer.principal, "kb:manage");
  const units = permissionReach(viewer.principal, "kb:manage_unit");
  const owned = units.all ? isNotNull(kbSpace.ownerUnitId) : units.unitIds.length ? inArray(kbSpace.ownerUnitId, units.unitIds) : NEVER;
  const byEntity = reach.all ? sql`true` : reach.entityIds.length ? inArray(kbSpace.entityId, reach.entityIds) : NEVER;
  // A project's document space is never managed through a role (policy.ts, canManageSpace).
  return both(isNull(kbSpace.ownerProjectId), either(byEntity, owned));
}

// ── Project rows (FR-PJM-31) ────────────────────────────────────────────────────────────────
//
// A `project:<id>` row names the people of a project as they are now: its members in any role,
// its lead, and the leads of its owning team — who, by the work policy, answer for every project
// of the team. Why an access row and not a space column: it is the KB's own mechanism (a space
// can still be opened wider with ordinary rows, a subtree narrowed), and why resolved here rather
// than as extra viewer keys: `kbViewerOf` stays synchronous for its forty-odd callers, and the
// SQL filter and the pure policy read the same tables in the same query as the rows themselves.
// The tables are the work module's; this reads them and never writes.

// Written with the tables' own names and short aliases rather than column objects: Drizzle leaves
// columns unqualified in a query without joins, and inside these subqueries an unqualified
// "team_id" or "id" would be ambiguous — or, worse, bind to the wrong table.

/** `project:<id>` for every project the person is one of the people of. */
const projectKeysOf = (personId: string): SQL => sql`(
  select 'project:' || pm.project_id::text from work_project_member pm where pm.person_id = ${personId}
  union all select 'project:' || p.id::text from work_project p where p.lead_person_id = ${personId}
  union all select 'project:' || p.id::text from work_project p inner join work_team_member tm on tm.team_id = p.team_id where tm.person_id = ${personId} and tm.role = 'lead'
)`;

/**
 * The people a row of `kb_access` names when it is a `project:<id>` row — a text array of person
 * ids — and null for any other row. For the loaders, so the pure policy can answer for the row
 * (`AccessRow.people`). The query must read `kb_access` un-aliased.
 */
export const projectPeopleSql = (): SQL<string[] | null> => sql<string[] | null>`(case when kb_access.subject_key like 'project:%' then (
  select coalesce(array_agg(distinct people.person_id::text), '{}'::text[]) from (
    select pm.person_id from work_project_member pm where pm.project_id::text = substr(kb_access.subject_key, 9)
    union all select p.lead_person_id from work_project p where p.id::text = substr(kb_access.subject_key, 9) and p.lead_person_id is not null
    union all select tm.person_id from work_project p inner join work_team_member tm on tm.team_id = p.team_id where p.id::text = substr(kb_access.subject_key, 9) and tm.role = 'lead'
  ) people
) end)`;

/** A row naming the viewer: one of their keys, or a project they are one of the people of. */
const namesViewer = (viewer: KbViewer): SQL => sql`(${inArray(kbAccess.subjectKey, [...viewer.keys])} or ${kbAccess.subjectKey} in ${projectKeysOf(viewer.personId)})`;

const spaceRow = (viewer: KbViewer, editOnly: boolean): SQL =>
  viewer.keys.length === 0
    ? NEVER
    : sql`exists (select 1 from ${kbAccess} where ${kbAccess.spaceId} = ${kbSpace.id} and ${kbAccess.pageId} is null and ${namesViewer(viewer)}${editOnly ? sql` and ${kbAccess.level} = 'edit'` : sql``})`;

const rootRow = (viewer: KbViewer, editOnly: boolean): SQL =>
  viewer.keys.length === 0
    ? NEVER
    : sql`exists (select 1 from ${kbAccess} where ${kbAccess.pageId} = ${kbPage.accessRootId} and ${namesViewer(viewer)}${editOnly ? sql` and ${kbAccess.level} = 'edit'` : sql``})`;

/** Spaces the viewer may open (`spaceLevel` is not null). */
export const spaceVisibleSql = (viewer: KbViewer): SQL => either(spaceManagedSql(viewer), both(isNull(kbSpace.archivedAt), spaceRow(viewer, false)));

/** Spaces the viewer edits or manages. */
export const spaceEditableSql = (viewer: KbViewer): SQL => either(spaceManagedSql(viewer), both(isNull(kbSpace.archivedAt), spaceRow(viewer, true)));

const readableSql = (): SQL => both(isNotNull(kbPage.publishedVersionId), ne(kbPage.status, "archived"));

/** Pages the viewer may open (`pageLevel` is not null). Needs `kb_space` joined on `kb_page.space_id`. */
export function pageVisibleSql(viewer: KbViewer): SQL {
  return both(
    isNull(kbPage.deletedAt),
    either(
      spaceEditableSql(viewer),
      both(isNull(kbSpace.archivedAt), spaceRow(viewer, false), either(both(isNull(kbPage.accessRootId), readableSql()), both(isNotNull(kbPage.accessRootId), either(rootRow(viewer, true), both(rootRow(viewer, false), readableSql()))))),
    ),
  );
}

/** Pages the viewer sees as a reader would: published, not archived — whatever else they may do. For search, feeds and "new pages". */
export const pagePublishedVisibleSql = (viewer: KbViewer): SQL => both(pageVisibleSql(viewer), readableSql(), isNull(kbSpace.archivedAt));
