// Moving a task to another team (FR-PJM-34): its state is mapped by category onto the target
// team's workflow. Pure, so the task page can say where a task will land before it is moved.
import type { StateCategory } from "../enums";

type State = { id: string; category: string; isActive: boolean; sortOrder: number };

/**
 * When the target team has no active state of the same category, the nearest one that keeps the
 * task open (or closed) as it was. Cancelled work lands in "done" only as a last resort — both
 * are closed — and open work never lands in a closed state.
 */
const FALLBACK: Record<StateCategory, StateCategory[]> = {
  backlog: ["backlog", "todo"],
  todo: ["todo", "backlog"],
  in_progress: ["in_progress", "in_review", "todo"],
  in_review: ["in_review", "in_progress", "todo"],
  done: ["done"],
  cancelled: ["cancelled", "done"],
};

/** Each source state → the target team's first active state (by its order) of the same category, or null when there is none. */
export function mapStatesByCategory(from: readonly Pick<State, "id" | "category">[], to: readonly State[]): Map<string, string | null> {
  const targets = [...to].filter((state) => state.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const firstOf = (category: string) => targets.find((state) => state.category === category)?.id ?? null;
  return new Map(
    from.map((state) => {
      const chain = FALLBACK[state.category as StateCategory] ?? [state.category];
      return [state.id, chain.map(firstOf).find((id) => id !== null) ?? null];
    }),
  );
}
