import { describe, expect, it } from "vitest";
import type { Principal } from "../platform/rbac/policy";
import { audienceKey, parseAudienceKey } from "./enums";
import { canGiveKudos, canManageAnnouncement, canPostTo, canReadAnnouncement, canRemoveKudos, commsViewerKeys, phaseOf } from "./policy";

const SZM = "00000000-0000-4000-8000-000000000001";
const SZC = "00000000-0000-4000-8000-000000000002";
const VID = "00000000-0000-4000-8000-000000000011";
const DES = "00000000-0000-4000-8000-000000000012";
const HUY = "00000000-0000-4000-8000-000000000101";
const LONG = "00000000-0000-4000-8000-000000000102";

const principal = (personId: string, grants: Principal["grants"] = [], workforceType: Principal["workforceType"] = "employee"): Principal => ({ personId, workforceType, grants });
const head = principal(LONG, [{ role: "department_head", scope: { type: "unit", id: VID } }]);
const hrSzm = principal("hr", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const hrGroup = principal("hrg", [{ role: "hr_admin", scope: { type: "group" } }]);
const employee = principal(HUY);

const all = { key: "all", target: {} };
const szm = { key: audienceKey("entity", SZM), target: { entityId: SZM } };
const szc = { key: audienceKey("entity", SZC), target: { entityId: SZC } };
const vid = { key: audienceKey("unit", VID), target: { unitPath: [VID], entityId: null } };
const des = { key: audienceKey("unit", DES), target: { unitPath: [DES], entityId: null } };

describe("audience keys", () => {
  it("parses what it writes and refuses the rest", () => {
    expect(parseAudienceKey(audienceKey("branch", SZM))).toEqual({ type: "branch", id: SZM });
    expect(parseAudienceKey("all")).toEqual({ type: "all", id: null });
    for (const bad of ["", "everyone", "role:hr_staff", "entity:", "entity:not-a-uuid", "all:x"]) expect(parseAudienceKey(bad)).toBeNull();
  });
  it("a collaborator is reached by name only", () => {
    const placement = { entityId: SZM, unitId: VID, unitPath: [VID], branchId: SZC };
    expect(commsViewerKeys(employee, placement)).toEqual(["all", `entity:${SZM}`, `unit:${VID}`, `unit_only:${VID}`, `branch:${SZC}`, `person:${HUY}`]);
    expect(commsViewerKeys(principal(HUY, [], "collaborator"), placement)).toEqual([`person:${HUY}`]);
  });
});

describe("posting", () => {
  it("takes comms:manage over every target", () => {
    expect(canPostTo(head, [vid])).toBe(true);
    expect(canPostTo(head, [all])).toBe(false);
    expect(canPostTo(head, [vid, des])).toBe(false);
    expect(canPostTo(hrSzm, [szm])).toBe(true);
    expect(canPostTo(hrSzm, [szm, szc])).toBe(false);
    expect(canPostTo(hrSzm, [all])).toBe(false);
    expect(canPostTo(hrGroup, [all, szc, des])).toBe(true);
    expect(canPostTo(employee, [vid])).toBe(false);
  });
  it("refuses an empty audience and a key that names nothing", () => {
    expect(canPostTo(hrGroup, [])).toBe(false);
    expect(canPostTo(hrGroup, [{ key: "entity:x", target: null }])).toBe(false);
  });
  it("lets the author keep managing only while they hold the permission", () => {
    expect(canManageAnnouncement(head, { authorPersonId: LONG }, [vid, des])).toBe(true);
    expect(canManageAnnouncement(principal(LONG), { authorPersonId: LONG }, [vid])).toBe(false);
    expect(canManageAnnouncement(hrSzm, { authorPersonId: LONG }, [vid])).toBe(false);
    expect(canManageAnnouncement(hrGroup, { authorPersonId: LONG }, [vid])).toBe(true);
  });
});

describe("reading", () => {
  const now = new Date("2026-09-20T03:00:00Z");
  const live = { status: "published" as const, publishAt: new Date("2026-09-19T00:00:00Z"), expiresAt: null, authorPersonId: LONG };
  const viewer = { principal: employee, personId: HUY, keys: ["all", `unit:${VID}`, `person:${HUY}`] };
  it("knows the phases", () => {
    expect(phaseOf({ ...live, status: "draft" }, now)).toBe("draft");
    expect(phaseOf({ ...live, publishAt: new Date("2026-09-27T00:00:00Z") }, now)).toBe("scheduled");
    expect(phaseOf(live, now)).toBe("live");
    expect(phaseOf({ ...live, expiresAt: now }, now)).toBe("expired");
    expect(phaseOf({ ...live, status: "archived" }, now)).toBe("archived");
  });
  it("shows a live announcement to its audience only", () => {
    expect(canReadAnnouncement(viewer, live, [`unit:${VID}`], now)).toBe(true);
    expect(canReadAnnouncement(viewer, live, [`unit:${DES}`], now)).toBe(false);
    expect(canReadAnnouncement(viewer, { ...live, publishAt: new Date("2026-09-27T00:00:00Z") }, ["all"], now)).toBe(false);
    expect(canReadAnnouncement(viewer, { ...live, status: "draft" }, ["all"], now)).toBe(false);
  });
});

describe("kudos", () => {
  const to = { personId: LONG, status: "active", workforceType: "employee", entityId: SZM, unitPath: [VID] };
  it("goes from staff to other active staff", () => {
    expect(canGiveKudos(employee, to)).toBe(true);
    expect(canGiveKudos(employee, { ...to, personId: HUY })).toBe(false);
    expect(canGiveKudos(employee, { ...to, status: "offboarded" })).toBe(false);
    expect(canGiveKudos(employee, { ...to, workforceType: "collaborator" })).toBe(false);
    expect(canGiveKudos(principal(HUY, [], "collaborator"), to)).toBe(false);
  });
  it("is removed by its sender or by comms:manage over the recipient", () => {
    expect(canRemoveKudos(employee, { fromPersonId: HUY }, to)).toBe(true);
    expect(canRemoveKudos(head, { fromPersonId: HUY }, to)).toBe(true);
    expect(canRemoveKudos(hrSzm, { fromPersonId: HUY }, { ...to, entityId: SZC, unitPath: [DES] })).toBe(false);
    expect(canRemoveKudos(principal("other"), { fromPersonId: HUY }, to)).toBe(false);
  });
});
