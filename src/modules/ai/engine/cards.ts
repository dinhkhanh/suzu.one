// The cards under an answer (FR-AGT-05): one per tool that read something. Two tools often read
// the same record — find_project, then project_status for the project it found — and would show
// it twice. Pure.
import type { AgentCard } from "../enums";

const recordsOf = (card: AgentCard) => [...new Set(card.items.map((item) => item.href ?? item.label))].sort().join("\n");

/**
 * The cards to show: a card that lists exactly the records a later card lists is dropped — the
 * later tool read further. A proposal is never dropped, and neither is a card listing more or other
 * records (the candidates a look-up found beside the one the answer is about).
 */
export function distinctCards(cards: readonly AgentCard[]): AgentCard[] {
  return cards.filter((card, index) => {
    if (card.proposal || card.items.length === 0) return true;
    const records = recordsOf(card);
    return !cards.slice(index + 1).some((later) => !later.proposal && later.items.length > 0 && recordsOf(later) === records);
  });
}
