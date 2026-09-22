// The entity × month matrix of the compliance dashboard (FR-OPS-07). Pure: counts by status colour.
import type { StatusColour } from "../enums";

export type DashboardItem = { entityId: string; dueDate: string | null; colour: StatusColour; escalationLevel: number };
export type DashboardCell = { month: string; total: number; counts: Partial<Record<StatusColour, number>>; /** Overdue items somebody above the owner has been told about. */ escalated: number };
export type DashboardRow<Entity> = { entity: Entity; cells: DashboardCell[] };

/** The worst thing in a cell decides how it reads at a glance. */
export const COLOUR_SEVERITY: readonly StatusColour[] = ["overdue", "due_soon", "done_late", "upcoming", "done"];

export function worstColour(cell: DashboardCell): StatusColour | null {
  return COLOUR_SEVERITY.find((colour) => (cell.counts[colour] ?? 0) > 0) ?? null;
}

/** Items already counted per entity, month and colour (what the dashboard query returns). */
export type DashboardCount = { entityId: string; month: string; colour: StatusColour; count: number; /** Of `count`, overdue items somebody above the owner has been told about. */ escalated: number };

/** Cancelled ("not applicable") items are left out: they are neither work nor proof. An item sits in the month of its due date. */
export function dashboardMatrix<Entity extends { id: string }>(entities: readonly Entity[], months: readonly string[], items: readonly DashboardItem[]): DashboardRow<Entity>[] {
  const counts = items.flatMap((item): DashboardCount[] => (item.dueDate ? [{ entityId: item.entityId, month: item.dueDate.slice(0, 7), colour: item.colour, count: 1, escalated: item.escalationLevel > 0 && item.colour === "overdue" ? 1 : 0 }] : []));
  return dashboardMatrixFromCounts(entities, months, counts);
}

/** The same matrix from pre-aggregated counts; cancelled and out-of-range counts are left out. */
export function dashboardMatrixFromCounts<Entity extends { id: string }>(entities: readonly Entity[], months: readonly string[], counts: readonly DashboardCount[]): DashboardRow<Entity>[] {
  const cells = new Map<string, DashboardCell>();
  for (const entity of entities) for (const month of months) cells.set(`${entity.id}|${month}`, { month, total: 0, counts: {}, escalated: 0 });
  for (const row of counts) {
    if (row.colour === "cancelled" || row.count === 0) continue;
    const cell = cells.get(`${row.entityId}|${row.month}`);
    if (!cell) continue;
    cell.total += row.count;
    cell.counts[row.colour] = (cell.counts[row.colour] ?? 0) + row.count;
    if (row.colour === "overdue") cell.escalated += row.escalated;
  }
  return entities.map((entity) => ({ entity, cells: months.map((month) => cells.get(`${entity.id}|${month}`)!) }));
}
