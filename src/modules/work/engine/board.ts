// The kanban board's arithmetic (FR-WRK-05): columns ordered by rank, and what a drop means.
// Pure, so the optimistic move in the browser and the server agree on where the card lands.
import { rankBetween } from "./graph";

export type BoardCard = { id: string; stateId: string; boardRank: number };

/** Cards per state, top to bottom. States without cards still get a (empty) column. */
export function boardColumns<Card extends BoardCard>(cards: readonly Card[], stateIds: readonly string[]): Map<string, Card[]> {
  const columns = new Map<string, Card[]>(stateIds.map((id) => [id, []]));
  for (const card of cards) columns.get(card.stateId)?.push(card);
  for (const column of columns.values()) column.sort((a, b) => a.boardRank - b.boardRank || a.id.localeCompare(b.id));
  return columns;
}

/**
 * Dropping `cardId` at `index` of a column (counted without the card itself): the neighbours the
 * server ranks it between, and the rank the browser shows meanwhile.
 */
export function planDrop<Card extends BoardCard>(column: readonly Card[], cardId: string, index: number): { beforeTaskId: string | null; afterTaskId: string | null; boardRank: number } {
  const others = column.filter((card) => card.id !== cardId);
  const at = Math.max(0, Math.min(index, others.length));
  const before = others[at - 1] ?? null;
  const after = others[at] ?? null;
  return { beforeTaskId: before?.id ?? null, afterTaskId: after?.id ?? null, boardRank: rankBetween(before?.boardRank ?? null, after?.boardRank ?? null) };
}

/** Is the drop a no-op (same column, same neighbours)? */
export function isSamePlace<Card extends BoardCard>(column: readonly Card[], card: Card, stateId: string, index: number): boolean {
  if (card.stateId !== stateId) return false;
  const current = column.findIndex((row) => row.id === card.id);
  return current === Math.max(0, Math.min(index, column.length - 1));
}
