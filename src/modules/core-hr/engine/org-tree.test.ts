import { describe, expect, it } from "vitest";
import { buildOrgTree, type OrgNode, type OrgPerson } from "./org-tree";

const person = (id: string, managerId: string | null = null): OrgPerson => ({ id, managerId, sortKey: id });
const shape = (nodes: OrgNode<OrgPerson>[]): unknown => nodes.map((node) => (node.reports.length ? { [node.person.id]: shape(node.reports) } : node.person.id));
const everyone = (nodes: OrgNode<OrgPerson>[]): string[] => nodes.flatMap((node) => [node.person.id, ...everyone(node.reports)]);

describe("buildOrgTree", () => {
  it("nests reports under their manager, sorted, with headcounts", () => {
    const tree = buildOrgTree([person("tam", "long"), person("ha", "khanh"), person("long", "ha"), person("huy", "long"), person("khanh"), person("chi", "ha")]);
    expect(shape(tree)).toEqual([{ khanh: [{ ha: ["chi", { long: ["huy", "tam"] }] }] }]);
    expect(tree[0].headcount).toBe(5);
    expect(tree[0].reports[0].reports[1].headcount).toBe(2);
  });

  it("makes people whose manager is outside the selection the top of their own branch", () => {
    const tree = buildOrgTree([person("long", "ha-in-another-entity"), person("huy", "long"), person("self", "self")]);
    expect(shape(tree)).toEqual([{ long: ["huy"] }, "self"]);
  });

  it("survives reporting loops: everyone appears exactly once", () => {
    const people = [person("a", "c"), person("b", "a"), person("c", "b"), person("d", "a"), person("root"), person("x", "y"), person("y", "x")];
    const tree = buildOrgTree(people);
    expect(everyone(tree).sort()).toEqual(people.map((p) => p.id).sort());
    expect(shape(tree)).toEqual(["root", { a: [{ b: ["c"] }, "d"] }, { x: ["y"] }]);
  });

  it("handles nobody", () => {
    expect(buildOrgTree([])).toEqual([]);
  });
});
