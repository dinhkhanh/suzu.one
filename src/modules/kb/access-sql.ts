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
  if (reach.all) return sql`true`;
  const units = permissionReach(viewer.principal, "kb:manage_unit");
  const owned = units.all ? isNotNull(kbSpace.ownerUnitId) : units.unitIds.length ? inArray(kbSpace.ownerUnitId, units.unitIds) : NEVER;
  return either(reach.entityIds.length ? inArray(kbSpace.entityId, reach.entityIds) : NEVER, owned);
}

const spaceRow = (viewer: KbViewer, editOnly: boolean): SQL =>
  viewer.keys.length === 0
    ? NEVER
    : sql`exists (select 1 from ${kbAccess} where ${kbAccess.spaceId} = ${kbSpace.id} and ${kbAccess.pageId} is null and ${inArray(kbAccess.subjectKey, [...viewer.keys])}${editOnly ? sql` and ${kbAccess.level} = 'edit'` : sql``})`;

const rootRow = (viewer: KbViewer, editOnly: boolean): SQL =>
  viewer.keys.length === 0
    ? NEVER
    : sql`exists (select 1 from ${kbAccess} where ${kbAccess.pageId} = ${kbPage.accessRootId} and ${inArray(kbAccess.subjectKey, [...viewer.keys])}${editOnly ? sql` and ${kbAccess.level} = 'edit'` : sql``})`;

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
