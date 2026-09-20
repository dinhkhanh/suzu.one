// The review step (FR-WRK-08), the parts that are rules rather than storage. Pure.
import type { StateCategory } from "../enums";

export type ReviewState = { id: string; category: StateCategory; sortOrder: number; isActive: boolean };

/** The first candidate who is not the person handing the work in: nobody reviews their own deliverable. */
export function pickReviewer(candidates: readonly (string | null | undefined)[], submitterId: string): string | null {
  return candidates.find((id): id is string => !!id && id !== submitterId) ?? null;
}

const ordered = (states: readonly ReviewState[]) => states.filter((state) => state.isActive).sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * Where a task goes when a deliverable is handed in: the team's first review state — unless it
 * already sits in a review state (a second round, or the client's review after the internal one)
 * or the team has none.
 */
export function stateOnSubmit(states: readonly ReviewState[], currentStateId: string): string | null {
  const current = states.find((state) => state.id === currentStateId);
  if (current?.category === "in_review") return null;
  return ordered(states).find((state) => state.category === "in_review")?.id ?? null;
}

/** Approved in a review state → the next step of the workflow (Internal review → Client review → Scheduled). Elsewhere the task stays. */
export function stateOnApproval(states: readonly ReviewState[], currentStateId: string): string | null {
  const list = ordered(states);
  const index = list.findIndex((state) => state.id === currentStateId);
  if (index < 0 || list[index].category !== "in_review") return null;
  return list.slice(index + 1).find((state) => state.category !== "cancelled" && state.category !== "backlog")?.id ?? null;
}

/** Changes requested in a review state → back to the nearest working step before it (Edit, In progress). */
export function stateOnChangesRequested(states: readonly ReviewState[], currentStateId: string): string | null {
  const list = ordered(states);
  const index = list.findIndex((state) => state.id === currentStateId);
  if (index < 0 || list[index].category !== "in_review") return null;
  return list.slice(0, index).reverse().find((state) => state.category === "in_progress")?.id ?? null;
}
