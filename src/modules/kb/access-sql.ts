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

/** The owning project's team place for a `project:<id>` row, and null for any other row. */
export const projectPlaceSql = (): SQL<{ entityId: string | null; departmentId: string | null } | null> => sql<{ entityId: string | null; departmentId: string | null } | null>`(case when kb_access.subject_key like 'project:%' then (
  select json_build_object('entityId', t.entity_id, 'departmentId', t.department_id)
  from work_project p inner join work_team t on t.id = p.team_id where p.id::text = substr(kb_access.subject_key, 9)
) end)`;

const values = (list: readonly string[]): SQL => sql.join(list.map((value) => sql`${value}`), sql`, `);

/**
 * A `project:<id>` row also opens the space to whoever may open the project itself without being
 * one of its people: a `pjm:portfolio` holder over the owning team (FR-PJM-8, and the owner's
 * decision of 2026-09-23, Q25, which let them open a private project). At `view` only — they read
 * the project, they write nothing in it — so this never joins the `editOnly` filters, and
 * `kb:manage` is left exactly as it was: a role still does not reach a project's space.
 * `policy.ts` (`matched`) says the same thing about a loaded row's `project`.
 */
const portfolioProjectRow = (viewer: KbViewer): SQL => {
  const reach = permissionReach(viewer.principal, "pjm:portfolio");
  if (!reach.all && reach.entityIds.length === 0 && reach.unitIds.length === 0) return NEVER;
  const place = reach.all ? sql`true` : either(...[...(reach.entityIds.length ? [sql`t.entity_id in (${values(reach.entityIds)})`] : []), ...(reach.unitIds.length ? [sql`t.department_id in (${values(reach.unitIds)})`] : [])]);
  return sql`(kb_access.subject_key like 'project:%' and exists (select 1 from work_project p inner join work_team t on t.id = p.team_id where p.id::text = substr(kb_access.subject_key, 9) and ${place}))`;
};

/** A row naming the viewer: one of their keys, or a project they are one of the people of. */
const namesViewer = (viewer: KbViewer): SQL => sql`(${inArray(kbAccess.subjectKey, [...viewer.keys])} or ${kbAccess.subjectKey} in ${projectKeysOf(viewer.personId)})`;

const spaceRow = (viewer: KbViewer, editOnly: boolean): SQL =>
  viewer.keys.length === 0
    ? NEVER
    : sql`exists (select 1 from ${kbAccess} where ${kbAccess.spaceId} = ${kbSpace.id} and ${kbAccess.pageId} is null and ${editOnly ? sql`${namesViewer(viewer)} and ${kbAccess.level} = 'edit'` : either(namesViewer(viewer), portfolioProjectRow(viewer))})`;

const rootRow = (viewer: KbViewer, editOnly: boolean): SQL =>
  viewer.keys.length === 0
    ? NEVER
    : sql`exists (select 1 from ${kbAccess} where ${kbAccess.pageId} = ${kbPage.accessRootId} and ${editOnly ? sql`${namesViewer(viewer)} and ${kbAccess.level} = 'edit'` : either(namesViewer(viewer), portfolioProjectRow(viewer))})`;

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
