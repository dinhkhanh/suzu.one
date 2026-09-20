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

export type Placement = { entityId: string | null; departmentId: string | null; teamId: string | null };
export type KbViewer = { principal: Principal; personId: string; keys: readonly string[] };

/** The subject keys that describe the viewer. Collaborators are nobody's "all staff": only rows naming them count. */
export function viewerKeys(principal: Principal, placement: Placement): string[] {
  if (!principal.personId) return [];
  const own = subjectKey("person", principal.personId);
  if (principal.workforceType === "collaborator") return [own];
  return [
    ...new Set([
      "all",
      ...(placement.entityId ? [subjectKey("entity", placement.entityId)] : []),
      ...(placement.departmentId ? [subjectKey("department", placement.departmentId)] : []),
      ...(placement.teamId ? [subjectKey("team", placement.teamId)] : []),
      ...principal.grants.map((grant) => subjectKey("role", grant.role)),
      own,
    ]),
  ];
}

export type ViewerSource = { person: { id: string; primaryEntityId: string | null; departmentId: string | null; teamId: string | null }; principal: Principal };

export const kbViewerOf = (user: ViewerSource): KbViewer => ({
  principal: user.principal,
  personId: user.person.id,
  keys: viewerKeys(user.principal, { entityId: user.person.primaryEntityId, departmentId: user.person.departmentId, teamId: user.person.teamId }),
});

export type AccessRow = { subjectKey: string; level: AccessLevel };
export type SpaceFacts = { entityId: string | null; kind: SpaceKind; archived: boolean; access: readonly AccessRow[] };
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

function matched(viewer: KbViewer, rows: readonly AccessRow[]): AccessLevel | null {
  const own = rows.filter((row) => viewer.keys.includes(row.subjectKey));
  return own.some((row) => row.level === "edit") ? "edit" : own.length ? "view" : null;
}

/** Create, archive, settings, access rows: a `kb:manage` grant over the space's entity (group-wide for a group space). */
export const canManageSpace = (principal: Principal, space: { entityId: string | null }): boolean => can(principal, "kb:manage", { entityId: space.entityId });

/** The "new space" button. Never guards data. */
export const canManageAnySpace = (principal: Principal): boolean => can(principal, "kb:manage");

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
