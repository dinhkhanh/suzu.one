// Who may see and do what in the knowledge base (FR-KB-03). Pure.
//
// A space is opened to people by access rows — "all staff", an entity, a department, a team, a
// role, one person — at level `view` or `edit`. `kb:manage` over the space's entity (a group-wide
// grant for a group space) is the third level: settings, access rows, publishing in a controlled
// space. A page can carry rows of its own: it and everything under it is then read only by the
// people those rows name (and by the space's editors and managers).
// Readers see published pages and their published version; editors also see drafts.
// `access-sql.ts` says the same thing as WHERE clauses; a test keeps the two in step.
import { can, type Principal } from "../platform/rbac/policy";
import { type AccessLevel, type SpaceKind, subjectKey } from "./enums";

export type Placement = { entityId: string | null; unitId: string | null; unitPath: readonly string[] };
export type KbViewer = { principal: Principal; personId: string; keys: readonly string[] };

/**
 * The subject keys that describe the viewer: one per unit above them (so a row on any ancestor
 * matches), plus `unit_only` for the unit they actually sit in. Collaborators are nobody's
 * "all staff": only rows naming them count.
 */
export function viewerKeys(principal: Principal, placement: Placement): string[] {
  if (!principal.personId) return [];
  const own = subjectKey("person", principal.personId);
  if (principal.workforceType === "collaborator") return [own];
  return [
    ...new Set([
      "all",
      ...(placement.entityId ? [subjectKey("entity", placement.entityId)] : []),
      ...placement.unitPath.map((unitId) => subjectKey("unit", unitId)),
      ...(placement.unitId ? [subjectKey("unit_only", placement.unitId)] : []),
      ...principal.grants.map((grant) => subjectKey("role", grant.role)),
      own,
    ]),
  ];
}

export type ViewerSource = { person: { id: string; primaryEntityId: string | null; orgUnitId: string | null; orgUnitPath: readonly string[] }; principal: Principal };

export const kbViewerOf = (user: ViewerSource): KbViewer => ({
  principal: user.principal,
  personId: user.person.id,
  keys: viewerKeys(user.principal, { entityId: user.person.primaryEntityId, unitId: user.person.orgUnitId, unitPath: user.person.orgUnitPath }),
});

/**
 * An access row. A `project:<id>` row also carries `people`: whom the project names at the moment
 * the row was read (its members, its lead, the leads of its owning team), filled in by the loader
 * in the same query (`access-sql.ts`). The viewer's keys stay synchronous — `kbViewerOf` needs no
 * database — and the pure policy still decides alone. A row read without `people` names nobody.
 */
export type AccessRow = {
  subjectKey: string;
  level: AccessLevel;
  people?: readonly string[] | null;
  /** A `project:<id>` row also carries the project's visibility and the owning team's place, filled in by the loader (`projectPlaceSql`). */
  project?: { entityId: string | null; departmentId: string | null; visibility?: string | null } | null;
};
export type SpaceFacts = {
  entityId: string | null;
  kind: SpaceKind;
  archived: boolean;
  access: readonly AccessRow[];
  /** A unit-owned space (FR-KB-13): the unit and its ancestors, so the heads above it inherit. */
  ownerUnitPath?: readonly string[] | null;
  /** A project's document space (FR-PJM-31): no role manages it. */
  ownerProjectId?: string | null;
};
export type PageFacts = {
  /** Has a published version and is neither archived nor deleted. */
  readable: boolean;
  deleted: boolean;
  /** The rows of the page's access root; null = the page follows its space. */
  rootAccess: readonly AccessRow[] | null;
};

export type KbLevel = "view" | "edit" | "manage";
const RANK: Record<KbLevel, number> = { view: 1, edit: 2, manage: 3 };
export const atLeast = (level: KbLevel | null, wanted: KbLevel): boolean => !!level && RANK[level] >= RANK[wanted];

/**
 * A **private** project's `project:<id>` row also opens the space to the one reader the owner's
 * decision of 2026-09-23 (Q25 — D30) let into a private project without being one of its people:
 * a `pjm:portfolio` holder over the owning team (FR-PJM-8). No further: the decision was about
 * private projects, and a project space has always been its people's alone whatever the project's
 * visibility. Reading only — they never reach `edit`, and `kb:manage` is untouched, a role still
 * does not reach a project's space. `access-sql.ts` (`portfolioProjectRow`) says this in SQL.
 */
const opensByPortfolio = (viewer: KbViewer, rows: readonly AccessRow[]): boolean =>
  rows.some((row) => !!row.project && row.project.visibility === "private" && can(viewer.principal, "pjm:portfolio", { entityId: row.project.entityId, unitPath: row.project.departmentId ? [row.project.departmentId] : [] }));

function matched(viewer: KbViewer, rows: readonly AccessRow[]): AccessLevel | null {
  const own = rows.filter((row) => viewer.keys.includes(row.subjectKey) || (!!row.people && row.people.includes(viewer.personId)));
  if (own.some((row) => row.level === "edit")) return "edit";
  if (own.length) return "view";
  return opensByPortfolio(viewer, rows) ? "view" : null;
}

/**
 * Create, archive, settings, access rows. Two ways in (FR-KB-13):
 *  · `kb:manage` over the space's entity — HR, and group-wide for a company space;
 *  · `kb:manage_unit` over the unit that owns it — its head, and the heads of the units above it,
 *    because a unit grant carries its subtree.
 */
/** A space row as `canManageSpace` reads it. */
export const spaceOwner = (space: { entityId: string | null; ownerUnitId: string | null; ownerProjectId?: string | null }) => ({ entityId: space.entityId, ownerUnitPath: space.ownerUnitId ? [space.ownerUnitId] : null, ownerProjectId: space.ownerProjectId ?? null });

// A project's document space is managed by nobody through a role: it opens to the project's people
// by its access row, and `kb:manage` stops at its door (FR-PJM-31; see kb_space.owner_project_id).
export const canManageSpace = (principal: Principal, space: { entityId: string | null; ownerUnitPath?: readonly string[] | null; ownerProjectId?: string | null }): boolean =>
  !space.ownerProjectId && (can(principal, "kb:manage", { entityId: space.entityId }) || (!!space.ownerUnitPath?.length && can(principal, "kb:manage_unit", { unitPath: space.ownerUnitPath, entityId: space.entityId })));

/** The "new space" button. Never guards data. */
export const canManageAnySpace = (principal: Principal): boolean => can(principal, "kb:manage") || can(principal, "kb:manage_unit");

export function spaceLevel(viewer: KbViewer, space: SpaceFacts): KbLevel | null {
  if (canManageSpace(viewer.principal, space)) return "manage";
  // An archived space is its managers' alone.
  return space.archived ? null : matched(viewer, space.access);
}

export function pageLevel(viewer: KbViewer, space: SpaceFacts, page: PageFacts): KbLevel | null {
  if (page.deleted) return null;
  const inSpace = spaceLevel(viewer, space);
  if (!inSpace) return null;
  if (inSpace !== "view") return inSpace;
  // A plain reader: a restricted subtree needs a row naming them, and that row may let them edit it.
  const inSubtree = page.rootAccess ? matched(viewer, page.rootAccess) : "view";
  if (!inSubtree) return null;
  if (inSubtree === "edit") return "edit";
  return page.readable ? "view" : null;
}

export const canViewPage = (viewer: KbViewer, space: SpaceFacts, page: PageFacts): boolean => pageLevel(viewer, space, page) !== null;
export const canEditPage = (viewer: KbViewer, space: SpaceFacts, page: PageFacts): boolean => atLeast(pageLevel(viewer, space, page), "edit");

/** New pages: the space's editors, or — under a page — whoever may edit that page. */
export const canCreatePage = (viewer: KbViewer, space: SpaceFacts, parent: PageFacts | null): boolean => (parent ? canEditPage(viewer, space, parent) : atLeast(spaceLevel(viewer, space), "edit"));

/**
 * Publishing straight away. Open space: any editor. Controlled space: its managers only — an
 * editor's revision goes through review instead (the approval engine, week 2).
 */
export function canPublishDirectly(viewer: KbViewer, space: SpaceFacts, page: PageFacts): boolean {
  const level = pageLevel(viewer, space, page);
  return space.kind === "controlled" ? level === "manage" : atLeast(level, "edit");
}

/** Restricting a subtree, moving pages between parents, archiving, deleting: editors of the space itself. */
export const canOrganisePages = (viewer: KbViewer, space: SpaceFacts): boolean => atLeast(spaceLevel(viewer, space), "edit");
