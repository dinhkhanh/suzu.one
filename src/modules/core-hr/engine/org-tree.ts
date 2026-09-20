// Builds the org chart from line-manager links (FR-PLT-13, FR-CHR-13). Pure: no I/O.
// Real data is never a clean tree: a manager may be outside the selection (another entity, or
// left the company), and a bad import can close a loop. Everyone still appears exactly once.

export type OrgPerson = { id: string; managerId: string | null; sortKey: string };
export type OrgNode<Person extends OrgPerson> = { person: Person; reports: OrgNode<Person>[]; /** Everyone below, at any depth. */ headcount: number };

export function buildOrgTree<Person extends OrgPerson>(people: readonly Person[]): OrgNode<Person>[] {
  const byId = new Map(people.map((person) => [person.id, person]));
  const reportsOf = new Map<string, Person[]>();
  for (const person of people) {
    // A manager who is not in the selection makes the person the top of their own branch.
    if (!person.managerId || person.managerId === person.id || !byId.has(person.managerId)) continue;
    reportsOf.set(person.managerId, [...(reportsOf.get(person.managerId) ?? []), person]);
  }

  const placed = new Set<string>();
  const bySortKey = (a: Person, b: Person) => a.sortKey.localeCompare(b.sortKey);
  const grow = (person: Person): OrgNode<Person> => {
    placed.add(person.id);
    // `placed` also stops a loop: whoever would appear a second time is left out of this branch.
    const reports = (reportsOf.get(person.id) ?? []).filter((report) => !placed.has(report.id)).sort(bySortKey).map(grow);
    return { person, reports, headcount: reports.reduce((sum, node) => sum + 1 + node.headcount, 0) };
  };

  const hasManager = (person: Person) => !!person.managerId && person.managerId !== person.id && byId.has(person.managerId);
  const roots = people.filter((person) => !hasManager(person)).sort(bySortKey).map(grow);
  // Whoever is still missing sits in a loop with no way in from a root: open each loop at its first member.
  for (const person of [...people].sort(bySortKey)) if (!placed.has(person.id)) roots.push(grow(person));
  return roots;
}
