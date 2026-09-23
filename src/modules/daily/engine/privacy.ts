// A team total of one person is that person (security review, finding 22): utilisation by team, EOD
// and timesheet compliance by team — figures meant to be read as a group — say what one person did
// when the group is one person. So for a reader who does not run the team (a `work:manage` holder
// looking across a scope), groups of fewer than `MIN_GROUP_PEOPLE` are folded into one "other" row,
// and if even that row would be one person they are left out altogether — of the rows and of any
// total shown beside them, which would otherwise give the same number by subtraction. The same
// threshold as the profitability breakdown (reports/engine/profitability.ts).
// Pure.

export const MIN_GROUP_PEOPLE = 2;

export type GroupPeople = { key: string; personIds: readonly string[] };
export type FoldedGroups = {
  /** The groups shown as themselves, in the order given. */
  kept: string[];
  /** The folded groups and the people in them, as one "other" row — null when there is nothing to show. */
  other: { keys: string[]; personIds: string[] } | null;
  /** People whose figures must not be shown at all, not even inside a total. */
  dropped: string[];
};

/**
 * Splits the groups a reader does not run into those big enough to stand alone and an "other" row
 * of the rest. `exempt` keys (the reader's own teams) are always kept as they are.
 *
 * People in `dropped` have nowhere to hide — one person, and no other small group to join. Their
 * figures must be left out of every row **and of any total shown beside the rows**: a total that
 * still counted them would give their numbers by subtraction.
 */
export function foldSmallGroups(groups: readonly GroupPeople[], exempt: ReadonlySet<string>, min: number = MIN_GROUP_PEOPLE): FoldedGroups {
  const kept = groups.filter((group) => exempt.has(group.key) || new Set(group.personIds).size >= min);
  const folded = groups.filter((group) => !kept.includes(group));
  const otherPeople = new Set(folded.flatMap((group) => group.personIds));
  const safe = otherPeople.size >= min;
  return {
    kept: kept.map((group) => group.key),
    other: safe ? { keys: folded.map((group) => group.key), personIds: [...otherPeople] } : null,
    dropped: safe ? [] : [...otherPeople].filter((personId) => !kept.some((group) => group.personIds.includes(personId))),
  };
}
