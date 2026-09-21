// The org-unit tree as pure functions (FR-PLT-16). No I/O: the service loads units, this file
// says what the tree means. The database keeps `path` in step (`org_unit_path_set`); these
// functions read it, and `pathOf` is the reference the migration test checks the trigger against.
import type { OrgUnitKind } from "../enums";

export type UnitNode = {
  id: string;
  code: string | null;
  name: string;
  kind: OrgUnitKind;
  parentId: string | null;
  entityId: string | null;
  isActive: boolean;
  /** Root first, this unit last. */
  path: readonly string[];
};

/** A unit's ancestors and itself, root first — computed from `parentId` alone. Cycles stop it. */
export function pathOf(id: string, parentOf: ReadonlyMap<string, string | null>): string[] {
  const up: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = id;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    up.push(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return up.reverse();
}

/** Would making `parentId` the parent of `unitId` put the unit under itself? */
export const wouldLoop = (unitId: string, parentId: string | null, parentOf: ReadonlyMap<string, string | null>): boolean =>
  parentId !== null && (parentId === unitId || pathOf(parentId, parentOf).includes(unitId));

/** `unitId` and every unit below it. */
export const subtreeOf = (unitId: string, units: readonly UnitNode[]): UnitNode[] => units.filter((unit) => unit.path.includes(unitId));

/** The deepest unit of that kind on the way down to `unit` — what `person.department_id` and `person.team_id` cache. */
export function nearestOfKind(unit: UnitNode | undefined, kind: OrgUnitKind, byId: ReadonlyMap<string, UnitNode>): string | null {
  if (!unit) return null;
  for (let at = unit.path.length - 1; at >= 0; at--) {
    const ancestor = byId.get(unit.path[at]);
    if (ancestor?.kind === kind) return ancestor.id;
  }
  return null;
}

/** The two legacy placement columns, derived from one chosen unit. Their only definition. */
export const placementOf = (unitId: string | null, byId: ReadonlyMap<string, UnitNode>): { departmentId: string | null; teamId: string | null } => {
  const unit = unitId ? byId.get(unitId) : undefined;
  return { departmentId: nearestOfKind(unit, "department", byId), teamId: nearestOfKind(unit, "team", byId) };
};

export type TreeNode = UnitNode & { children: TreeNode[]; depth: number };

/** The units as a forest, each level ordered by name — what the admin screen and the pickers draw. */
export function buildTree(units: readonly UnitNode[]): TreeNode[] {
  const byId = new Map(units.map((unit) => [unit.id, { ...unit, children: [] as TreeNode[], depth: 0 }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const order = (nodes: TreeNode[], depth: number): TreeNode[] => {
    nodes.sort((left, right) => left.name.localeCompare(right.name, "vi"));
    for (const node of nodes) {
      node.depth = depth;
      order(node.children, depth + 1);
    }
    return nodes;
  };
  return order(roots, 0);
}

/** The forest flattened depth-first: the shape a `<select>` of units needs. */
export function flattenTree(nodes: readonly TreeNode[]): TreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}
