// What of a conversation goes with a follow-up question (FR-AGT-04). Pure.
//
// The last six turns, as text: what the person asked and what was answered. Tool results of
// earlier turns are NOT resent — they were read for that turn, under that turn's checks; a
// follow-up that needs a figure again calls the tool again, as the asker, now. An answer that
// was never stored (pay, D36) or that said nothing is left out, and two messages of the same side
// in a row are joined, because the API takes the conversation strictly in turns.

export const HISTORY_TURNS = 6;
/** One past message is cut here: a long answer is context, not material. */
const MESSAGE_MAX = 1500;

export type PastMessage = { role: "user" | "assistant"; body: string };
export type HistoryMessage = { role: "user" | "assistant"; content: string };

/**
 * The messages to send before the new question, oldest first, starting with the person's own and
 * ending with an answer — so the question can follow it. Empty for a new conversation.
 */
export function historyFor(past: readonly PastMessage[], turns: number = HISTORY_TURNS): HistoryMessage[] {
  const kept: HistoryMessage[] = [];
  for (const message of past.slice(-turns * 2)) {
    const content = message.body.trim().slice(0, MESSAGE_MAX);
    if (!content) continue;
    const last = kept.at(-1);
    if (last && last.role === message.role) last.content = `${last.content}\n\n${content}`;
    else kept.push({ role: message.role, content });
  }
  while (kept[0]?.role === "assistant") kept.shift();
  // The new question is the person's: what goes before it must end with an answer.
  while (kept.at(-1)?.role === "user") kept.pop();
  return kept;
}
