// The knowledge-base policy, pure: keys, levels, restricted subtrees, who publishes.
import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "../platform/rbac/policy";
import { atLeast, canCreatePage, canManageSpace, canOrganisePages, canPublishDirectly, type KbViewer, type PageFacts, pageLevel, type SpaceFacts, spaceLevel, viewerKeys } from "./policy";

const SZM = "11111111-1111-4111-8111-111111111111";
const SZC = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";
const CREW = "44444444-4444-4444-8444-444444444444";

const viewer = (personId: string, grants: Grant[] = [], placement = { entityId: SZM, unitId: VID as string | null, unitPath: [VID] as string[] }, workforceType: Principal["workforceType"] = "employee"): KbViewer => {
  const principal: Principal = { personId, workforceType, grants };
  return { principal, personId, keys: viewerKeys(principal, placement) };
};
const owner = viewer("owner", [{ role: "owner", scope: { type: "group" } }]);
const hrGroup = viewer("hr-group", [{ role: "hr_admin", scope: { type: "group" } }]);
const hrSzm = viewer("hr-szm", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const head = viewer("head", [{ role: "department_head", scope: { type: "unit", id: VID } }]);
const huy = viewer("huy", [], { entityId: SZM, unitId: CREW, unitPath: [VID, CREW] });
const khoi = viewer("khoi", [], { entityId: SZC, unitId: "dept-des", unitPath: ["dept-des"] });
const ngo = viewer("ngo", [], { entityId: SZM, unitId: VID, unitPath: [VID] }, "collaborator");

const space = (over: Partial<SpaceFacts>): SpaceFacts => ({ entityId: null, kind: "open", archived: false, access: [], ...over });
const published: PageFacts = { readable: true, deleted: false, rootAccess: null };
const draft: PageFacts = { readable: false, deleted: false, rootAccess: null };

describe("viewerKeys", () => {
  it("describes a member of staff by everything an access row can name", () => {
    expect(viewerKeys(huy.principal, { entityId: SZM, unitId: CREW, unitPath: [VID, CREW] })).toEqual(["all", `entity:${SZM}`, `unit:${VID}`, `unit:${CREW}`, `unit_only:${CREW}`, "person:huy"]);
    expect(hrSzm.keys).toContain("role:hr_staff");
  });

  it("gives a collaborator only their own key, and nobody without a person any", () => {
    expect(ngo.keys).toEqual(["person:ngo"]);
    expect(viewerKeys({ personId: null, workforceType: null, grants: [] }, { entityId: SZM, unitId: null, unitPath: [] })).toEqual([]);
  });
});

describe("spaces", () => {
  const handbook = space({ kind: "controlled", access: [{ subjectKey: "all", level: "view" }, { subjectKey: "role:hr_staff", level: "edit" }] });

  it("opens a space by its rows: all staff read, HR edits, a group-wide manager manages", () => {
    expect(spaceLevel(huy, handbook)).toBe("view");
    expect(spaceLevel(hrSzm, handbook)).toBe("edit"); // an entity's HR does not manage a group space
    expect(spaceLevel(hrGroup, handbook)).toBe("manage");
    expect(spaceLevel(owner, handbook)).toBe("manage");
    expect(spaceLevel(ngo, handbook)).toBeNull(); // "all" is the staff, not collaborators
    expect(spaceLevel(ngo, space({ access: [{ subjectKey: "person:ngo", level: "view" }] }))).toBe("view");
  });

  it("lets an entity's HR manage that entity's spaces only", () => {
    expect(canManageSpace(hrSzm.principal, { entityId: SZM })).toBe(true);
    expect(canManageSpace(hrSzm.principal, { entityId: SZC })).toBe(false);
    expect(canManageSpace(hrSzm.principal, { entityId: null })).toBe(false);
    expect(canManageSpace(head.principal, { entityId: SZM })).toBe(false);
  });

  it("scopes by entity, department and team", () => {
    const video = space({ access: [{ subjectKey: `unit:${VID}`, level: "edit" }] });
    expect(spaceLevel(huy, video)).toBe("edit");
    expect(spaceLevel(khoi, video)).toBeNull();
    expect(spaceLevel(khoi, space({ access: [{ subjectKey: `entity:${SZM}`, level: "view" }] }))).toBeNull();
    expect(spaceLevel(huy, space({ access: [{ subjectKey: `unit:${CREW}`, level: "view" }] }))).toBe("view");
  });

  it("keeps an archived space for its managers", () => {
    const archived = space({ archived: true, access: [{ subjectKey: "all", level: "edit" }] });
    expect(spaceLevel(huy, archived)).toBeNull();
    expect(spaceLevel(hrGroup, archived)).toBe("manage");
  });
});

// FR-KB-13: a unit's own space is run by its head, and by the heads of the units above it.
describe("a unit's own space", () => {
  // Design › Crew, as the tree nests them; a loaded grant carries the subtree it covers.
  const teamSpace = space({ access: [{ subjectKey: `unit:${CREW}`, level: "edit" }], ownerUnitPath: [CREW] });
  const leadOfCrew = viewer("lead", [{ role: "department_head", scope: { type: "unit", id: CREW, covers: [CREW] } }]);
  const headOfVid = viewer("long", [{ role: "department_head", scope: { type: "unit", id: VID, covers: [VID, CREW] } }]);
  const headOfDes = viewer("chi", [{ role: "department_head", scope: { type: "unit", id: "dept-des", covers: ["dept-des"] } }]);

  it("is run by the unit's head without HR, and by the head of a unit above it", () => {
    expect(spaceLevel(leadOfCrew, teamSpace)).toBe("manage");
    expect(spaceLevel(headOfVid, teamSpace)).toBe("manage");
    expect(spaceLevel(hrGroup, teamSpace)).toBe("manage");
  });

  it("is not another team's to run, and the people in it only read what the rows say", () => {
    expect(spaceLevel(headOfDes, teamSpace)).toBeNull();
    // huy sits in Crew, so the unit row names him — as an editor, which is the default.
    expect(spaceLevel(huy, teamSpace)).toBe("edit");
    expect(spaceLevel(khoi, teamSpace)).toBeNull();
    expect(spaceLevel(ngo, teamSpace)).toBeNull();
  });

  it("keeps a project's space out of every role's reach — the unit head's too (FR-PJM-31)", () => {
    const projectSpace = { entityId: SZM, ownerUnitPath: [VID], ownerProjectId: "project-1" };
    expect(canManageSpace(hrSzm.principal, projectSpace)).toBe(false);
    expect(canManageSpace(headOfVid.principal, projectSpace)).toBe(false);
    expect(canManageSpace(owner.principal, projectSpace)).toBe(false);
    // Without an owning project both ways in still work.
    expect(canManageSpace(headOfVid.principal, { ...projectSpace, ownerProjectId: null })).toBe(true);
  });

  it("gives a head nothing over a space that belongs to no unit", () => {
    expect(spaceLevel(headOfVid, space({ access: [{ subjectKey: "all", level: "view" }] }))).toBe("view");
    expect(canManageSpace(headOfVid.principal, { entityId: null })).toBe(false);
    expect(canManageSpace(headOfVid.principal, { entityId: null, ownerUnitPath: [CREW] })).toBe(true);
  });
});

describe("pages", () => {
  const handbook = space({ kind: "controlled", access: [{ subjectKey: "all", level: "view" }, { subjectKey: "role:hr_staff", level: "edit" }] });
  const tools = space({ access: [{ subjectKey: "all", level: "edit" }] });

  it("shows readers published pages only; editors see drafts", () => {
    expect(pageLevel(huy, handbook, published)).toBe("view");
    expect(pageLevel(huy, handbook, draft)).toBeNull();
    expect(pageLevel(hrSzm, handbook, draft)).toBe("edit");
    expect(pageLevel(huy, handbook, { ...published, deleted: true })).toBeNull();
    expect(pageLevel(owner, handbook, { ...published, deleted: true })).toBeNull();
  });

  it("closes a restricted subtree to readers the rows do not name — never to the space's editors", () => {
    const managersOnly: PageFacts = { ...published, rootAccess: [{ subjectKey: "role:department_head", level: "view" }] };
    expect(pageLevel(huy, handbook, managersOnly)).toBeNull();
    expect(pageLevel(head, handbook, managersOnly)).toBe("view");
    expect(pageLevel(hrSzm, handbook, managersOnly)).toBe("edit");
    expect(pageLevel(hrGroup, handbook, managersOnly)).toBe("manage");
    // A row on the page cannot open a space that is closed to the person.
    expect(pageLevel(khoi, space({ access: [{ subjectKey: `entity:${SZM}`, level: "view" }] }), { ...published, rootAccess: [{ subjectKey: "person:khoi", level: "edit" }] })).toBeNull();
  });

  it("lets a page row make a reader the editor of that subtree, drafts included", () => {
    const delegated: PageFacts = { ...draft, rootAccess: [{ subjectKey: "person:huy", level: "edit" }, { subjectKey: "all", level: "view" }] };
    expect(pageLevel(huy, handbook, delegated)).toBe("edit");
    expect(pageLevel(head, handbook, delegated)).toBeNull(); // named as a reader: the draft is not theirs to see
    expect(canCreatePage(huy, handbook, delegated)).toBe(true);
    expect(canCreatePage(huy, handbook, null)).toBe(false);
  });

  it("publishes directly in an open space for any editor, in a controlled space for its managers only", () => {
    expect(canPublishDirectly(huy, tools, draft)).toBe(true);
    expect(canPublishDirectly(hrSzm, handbook, draft)).toBe(false);
    expect(canPublishDirectly(hrGroup, handbook, draft)).toBe(true);
    expect(canPublishDirectly(huy, handbook, published)).toBe(false);
    expect(canPublishDirectly(hrSzm, space({ kind: "controlled", entityId: SZM }), draft)).toBe(true);
  });

  it("leaves organising the tree to the space's editors", () => {
    expect(canOrganisePages(huy, tools)).toBe(true);
    expect(canOrganisePages(huy, handbook)).toBe(false);
    expect(canOrganisePages(hrSzm, handbook)).toBe(true);
    expect(atLeast(null, "view")).toBe(false);
  });
});

describe("a project's space (FR-PJM-31)", () => {
  const PROJECT = "55555555-5555-4555-8555-555555555555";
  // The loader resolves a `project:<id>` row to the project's people as they are now.
  const projectSpace = (people: readonly string[] | null) => space({ entityId: SZM, access: [{ subjectKey: `project:${PROJECT}`, level: "edit", people }] });

  it("opens to the people the project row names, a collaborator among them, at the row's level", () => {
    const facts = projectSpace(["huy", "ngo"]);
    expect(spaceLevel(huy, facts)).toBe("edit");
    expect(spaceLevel(ngo, facts)).toBe("edit");
    expect(pageLevel(huy, facts, draft)).toBe("edit");
  });

  it("stays shut to a colleague in the same unit and entity, and to anyone when the row was read without its people", () => {
    expect(spaceLevel(head, projectSpace(["huy"]))).toBeNull();
    expect(spaceLevel(khoi, projectSpace(["huy"]))).toBeNull();
    expect(spaceLevel(huy, projectSpace(null))).toBeNull();
    // A viewer's own keys never include project keys: the row matches only through its people.
    expect(huy.keys.some((key) => key.startsWith("project:"))).toBe(false);
  });

  it("opens a private project's space to the reader D30 let in, and no other project's", () => {
    const boss = viewer("boss", [{ role: "entity_director", scope: { type: "entity", id: SZM } }]);
    const row = (visibility: string) => space({ entityId: SZM, access: [{ subjectKey: `project:${PROJECT}`, level: "edit", people: ["huy"], project: { entityId: SZM, departmentId: VID, visibility } }] });
    // Q25 (D30) let `pjm:portfolio` read a private project; its documents come with it, at view.
    expect(spaceLevel(boss, row("private"))).toBe("view");
    expect(pageLevel(boss, row("private"), published)).toBe("view");
    // A team or entity project's space was its people's alone before the decision and stays so.
    expect(spaceLevel(boss, row("team"))).toBeNull();
    expect(spaceLevel(boss, row("entity"))).toBeNull();
    // And a row read without its project (an older loader) opens nothing.
    expect(spaceLevel(boss, projectSpace(["huy"]))).toBeNull();
  });

  it("is still managed by the knowledge base's managers of the project's entity, like every space of it", () => {
    expect(spaceLevel(hrGroup, projectSpace(["huy"]))).toBe("manage");
    expect(spaceLevel(hrSzm, projectSpace(["huy"]))).toBe("manage");
    expect(spaceLevel(hrSzm, space({ entityId: SZC, access: [{ subjectKey: `project:${PROJECT}`, level: "edit", people: ["huy"] }] }))).toBeNull();
  });
});
