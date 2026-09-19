// The knowledge-base policy, pure: keys, levels, restricted subtrees, who publishes.
import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "../platform/rbac/policy";
import { atLeast, canCreatePage, canManageSpace, canOrganisePages, canPublishDirectly, type KbViewer, type PageFacts, pageLevel, type SpaceFacts, spaceLevel, viewerKeys } from "./policy";

const SZM = "11111111-1111-4111-8111-111111111111";
const SZC = "22222222-2222-4222-8222-222222222222";
const VID = "33333333-3333-4333-8333-333333333333";
const CREW = "44444444-4444-4444-8444-444444444444";

const viewer = (personId: string, grants: Grant[] = [], placement = { entityId: SZM, departmentId: VID, teamId: null as string | null }, workforceType: Principal["workforceType"] = "employee"): KbViewer => {
  const principal: Principal = { personId, workforceType, grants };
  return { principal, personId, keys: viewerKeys(principal, placement) };
};
const owner = viewer("owner", [{ role: "owner", scope: { type: "group" } }]);
const hrGroup = viewer("hr-group", [{ role: "hr_admin", scope: { type: "group" } }]);
const hrSzm = viewer("hr-szm", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const head = viewer("head", [{ role: "department_head", scope: { type: "department", id: VID } }]);
const huy = viewer("huy", [], { entityId: SZM, departmentId: VID, teamId: CREW });
const khoi = viewer("khoi", [], { entityId: SZC, departmentId: "dept-des", teamId: null });
const ngo = viewer("ngo", [], { entityId: SZM, departmentId: VID, teamId: null }, "collaborator");

const space = (over: Partial<SpaceFacts>): SpaceFacts => ({ entityId: null, kind: "open", archived: false, access: [], ...over });
const published: PageFacts = { readable: true, deleted: false, rootAccess: null };
const draft: PageFacts = { readable: false, deleted: false, rootAccess: null };

describe("viewerKeys", () => {
  it("describes a member of staff by everything an access row can name", () => {
    expect(viewerKeys(huy.principal, { entityId: SZM, departmentId: VID, teamId: CREW })).toEqual(["all", `entity:${SZM}`, `department:${VID}`, `team:${CREW}`, "person:huy"]);
    expect(hrSzm.keys).toContain("role:hr_staff");
  });

  it("gives a collaborator only their own key, and nobody without a person any", () => {
    expect(ngo.keys).toEqual(["person:ngo"]);
    expect(viewerKeys({ personId: null, workforceType: null, grants: [] }, { entityId: SZM, departmentId: null, teamId: null })).toEqual([]);
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
    const video = space({ access: [{ subjectKey: `department:${VID}`, level: "edit" }] });
    expect(spaceLevel(huy, video)).toBe("edit");
    expect(spaceLevel(khoi, video)).toBeNull();
    expect(spaceLevel(khoi, space({ access: [{ subjectKey: `entity:${SZM}`, level: "view" }] }))).toBeNull();
    expect(spaceLevel(huy, space({ access: [{ subjectKey: `team:${CREW}`, level: "view" }] }))).toBe("view");
  });

  it("keeps an archived space for its managers", () => {
    const archived = space({ archived: true, access: [{ subjectKey: "all", level: "edit" }] });
    expect(spaceLevel(huy, archived)).toBeNull();
    expect(spaceLevel(hrGroup, archived)).toBe("manage");
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
