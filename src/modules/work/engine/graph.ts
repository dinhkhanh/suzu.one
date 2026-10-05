// The cycle guard of the "blocks" graph, and the ranks of a board column. Pure. (The sub-task tree's
// own guard — a task never under itself — is a recursive query where the parent changes: tasks.ts.)

/** Would `blocker` → `blocked` close a loop? True when `blocker` is already (transitively) blocked by `blocked`. */
export function wouldCreateDependencyCycle(edges: readonly { blockerTaskId: string; blockedTaskId: string }[], blocker: string, blocked: string): boolean {
  if (blocker === blocked) return true;
  const blockedBy = new Map<string, string[]>();
  for (const edge of edges) blockedBy.set(edge.blockerTaskId, [...(blockedBy.get(edge.blockerTaskId) ?? []), edge.blockedTaskId]);
  // Walk everything `blocked` blocks; reaching `blocker` means the new edge points back into its own past.
  const seen = new Set<string>();
  const queue = [blocked];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current === blocker) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(blockedBy.get(current) ?? []));
  }
  return false;
}

/** A rank between two neighbours of a board column or list; either may be missing (the ends). */
export function rankBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000;
  if (before === null) return after! - 1000;
  if (after === null) return before + 1000;
  return (before + after) / 2;
}
