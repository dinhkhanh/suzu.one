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

/** Cancelled ("not applicable") items are left out: they are neither work nor proof. An item sits in the month of its due date. */
export function dashboardMatrix<Entity extends { id: string }>(entities: readonly Entity[], months: readonly string[], items: readonly DashboardItem[]): DashboardRow<Entity>[] {
  const cells = new Map<string, DashboardCell>();
  for (const entity of entities) for (const month of months) cells.set(`${entity.id}|${month}`, { month, total: 0, counts: {}, escalated: 0 });
  for (const item of items) {
    if (!item.dueDate || item.colour === "cancelled") continue;
    const cell = cells.get(`${item.entityId}|${item.dueDate.slice(0, 7)}`);
    if (!cell) continue;
    cell.total += 1;
    cell.counts[item.colour] = (cell.counts[item.colour] ?? 0) + 1;
    if (item.escalationLevel > 0 && item.colour === "overdue") cell.escalated += 1;
  }
  return entities.map((entity) => ({ entity, cells: months.map((month) => cells.get(`${entity.id}|${month}`)!) }));
}
