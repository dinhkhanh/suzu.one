// Goals against a real Postgres (PGlite): who sees what, check-in → current value → roll-up,
// the freeze at close, the rules of the tree, and the figures Phase 8 will read.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant, Principal } from "../platform/rbac/policy";
import { createCheckIn, createGoal, getOkrResults, type GoalDraft, goalFormOptions, listGoals, loadGoal, moveGoal, removeKeyResult, reparentGoal, resolveDraft, saveKeyResult, updateGoal, type Viewer } from "./goals";
import { canEditGoal } from "./policy";

type Who = "owner" | "ceo" | "hrSzm" | "long" | "tam" | "huy" | "linh" | "ngo" | "chi" | "khoi";
const ids = {} as Record<Who | "szm" | "szc" | "vid" | "des" | "crew", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const YEAR = 2027;

const viewers = {} as Record<Who, Viewer>;
const draft = (over: Partial<GoalDraft>): GoalDraft => ({ level: "group", entityId: null, departmentId: null, teamId: null, personId: null, ownerPersonId: null, parentGoalId: null, title: "Goal", description: null, periodKey: "2027", weight: 1, activate: true, ...over });
const numberKr = (title: string, start: string, target: string, weight = 1) => ({ title, metricType: "number" as const, startValue: start, targetValue: target, milestones: [], weight });
const titles = async (viewer: Viewer) => (await listGoals(viewer, { year: YEAR })).map((goal) => goal.title).sort();

const goals = {} as Record<"group" | "szm" | "vid" | "crew" | "huy" | "huyDraft" | "khoi" | "ngo", string>;
const krs = {} as Record<"huyVideos" | "huyRounds" | "huyCourse" | "vidRevenue", string>;

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [des] = await db().insert(schema.department).values({ code: "DES", name: "Design" }).returning();
  const [crew] = await db().insert(schema.team).values({ departmentId: vid.id, name: "Crew A" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, des: des.id, crew: crew.id });

  // owner → ceo → long (head of VID) → tam → huy; linh and the collaborator ngo also under long/tam; chi heads DES, khoi under chi.
  const people: [Who, string, string, Who | null, Grant["role"] | null, "group" | "entity" | "department" | null, "employee" | "collaborator"][] = [
    ["owner", szm.id, vid.id, null, "owner", "group", "employee"],
    ["ceo", szm.id, vid.id, "owner", "c_level", "group", "employee"],
    ["hrSzm", szm.id, vid.id, "ceo", "hr_staff", "entity", "employee"],
    ["long", szm.id, vid.id, "ceo", "department_head", "department", "employee"],
    ["tam", szm.id, vid.id, "long", null, null, "employee"],
    ["huy", szm.id, vid.id, "tam", null, null, "employee"],
    ["linh", szm.id, vid.id, "long", null, null, "employee"],
    ["ngo", szm.id, vid.id, "tam", null, null, "collaborator"],
    ["chi", szc.id, des.id, "ceo", "department_head", "department", "employee"],
    ["khoi", szc.id, des.id, "chi", null, null, "employee"],
  ];
  for (const [key, entityId, departmentId, manager, role, scope, workforceType] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", workforceType, primaryEntityId: entityId, departmentId, teamId: key === "huy" || key === "tam" ? crew.id : null, managerId: manager ? ids[manager] : null }).returning();
    ids[key] = row.id;
    const grants: Grant[] = role ? [{ role, scope: scope === "group" ? { type: "group" } : scope === "entity" ? { type: "entity", id: entityId } : { type: "department", id: departmentId } }] : [];
    const principal: Principal = { personId: row.id, workforceType, grants };
    viewers[key] = { principal, personId: row.id };
  }

  goals.group = (await createGoal(viewers.ceo, draft({ title: "Group: grow", ownerPersonId: ids.ceo }))).id;
  goals.szm = (await createGoal(viewers.ceo, draft({ level: "entity", entityId: ids.szm, title: "SZM: grow", ownerPersonId: ids.ceo, parentGoalId: goals.group, weight: 3 }))).id;
  goals.vid = (await createGoal(viewers.long, draft({ level: "department", departmentId: ids.vid, entityId: ids.szm, title: "VID: deliver", ownerPersonId: ids.long, parentGoalId: goals.szm }))).id;
  goals.crew = (await createGoal(viewers.long, draft({ level: "team", teamId: ids.crew, title: "Crew A: on time", ownerPersonId: ids.tam, parentGoalId: goals.vid }))).id;
  goals.huy = (await createGoal(viewers.huy, draft({ level: "individual", personId: ids.huy, title: "Huy: edit faster", parentGoalId: goals.crew, periodKey: "2027-Q1" }))).id;
  goals.huyDraft = (await createGoal(viewers.tam, draft({ level: "individual", personId: ids.huy, title: "Huy: draft", activate: false }))).id;
  goals.khoi = (await createGoal(viewers.chi, draft({ level: "individual", personId: ids.khoi, title: "Khoi: portfolio" }))).id;
  goals.ngo = (await createGoal(viewers.tam, draft({ level: "individual", personId: ids.ngo, title: "Ngo: showreel" }))).id;

  krs.huyVideos = (await saveKeyResult(goals.huy, null, numberKr("Videos delivered", "0", "40", 2))).after.id;
  krs.huyRounds = (await saveKeyResult(goals.huy, null, numberKr("Revision rounds per video", "4", "2"))).after.id;
  krs.huyCourse = (await saveKeyResult(goals.huy, null, { title: "Colour grading course", metricType: "milestone", startValue: null, targetValue: null, milestones: ["Enrol", "Finish", "Apply to a project", "Share with the team"], weight: 1 })).after.id;
  krs.vidRevenue = (await saveKeyResult(goals.szm, null, { title: "Revenue", metricType: "currency", startValue: "0", targetValue: "12.000.000.000", milestones: [], weight: 1 })).after.id;
});

describe("who sees what", () => {
  it("shows unit goals to the staff and individual goals along the reporting line only", async () => {
    const units = ["Crew A: on time", "Group: grow", "SZM: grow", "VID: deliver"];
    expect(await titles(viewers.owner)).toEqual([...units, "Huy: draft", "Huy: edit faster", "Khoi: portfolio", "Ngo: showreel"].sort());
    expect(await titles(viewers.hrSzm)).toEqual([...units, "Huy: draft", "Huy: edit faster", "Ngo: showreel"].sort()); // SZM only
    expect(await titles(viewers.long)).toEqual([...units, "Huy: draft", "Huy: edit faster", "Ngo: showreel"].sort()); // department head + skip-level
    expect(await titles(viewers.tam)).toEqual([...units, "Huy: draft", "Huy: edit faster", "Ngo: showreel"].sort()); // line manager
    expect(await titles(viewers.huy)).toEqual([...units, "Huy: draft", "Huy: edit faster"].sort());
    expect(await titles(viewers.linh)).toEqual(units); // a colleague sees no individual goal
    expect(await titles(viewers.chi)).toEqual([...units, "Khoi: portfolio"].sort()); // another department's head
    expect(await titles(viewers.ngo)).toEqual(["Ngo: showreel"]); // a collaborator: their own, nothing else
  });

  it("answers 'not found' for a goal that is not the viewer's to see, and counts hidden children", async () => {
    expect(await loadGoal(viewers.linh, goals.huy)).toBeNull();
    expect(await loadGoal(viewers.ngo, goals.group)).toBeNull();
    expect(await loadGoal(viewers.chi, goals.huy)).toBeNull();
    const asColleague = await loadGoal(viewers.linh, goals.crew);
    expect(asColleague).toMatchObject({ goal: { childIds: [], hiddenChildren: 1 }, children: [], rights: { edit: false, checkIn: false, close: false, reopen: false } });
    const asManager = await loadGoal(viewers.tam, goals.crew);
    expect(asManager?.children.map((child) => child.title)).toEqual(["Huy: edit faster"]);
    expect(asManager?.rights).toEqual({ edit: false, checkIn: true, close: false, reopen: false }); // accountable owner, not the department head
    expect((await loadGoal(viewers.huy, goals.huy))?.rights).toEqual({ edit: true, checkIn: true, close: false, reopen: false });
    expect((await loadGoal(viewers.tam, goals.huy))?.rights).toEqual({ edit: true, checkIn: true, close: true, reopen: false });
    expect((await loadGoal(viewers.hrSzm, goals.huy))?.rights).toEqual({ edit: true, checkIn: true, close: true, reopen: true });
  });

  it("offers the form only what the viewer may set goals for", async () => {
    const asHuy = await goalFormOptions(viewers.huy);
    expect(asHuy.levels).toEqual(["individual"]);
    expect(asHuy.people.map((person) => person.name)).toEqual(["huy"]);
    const asLong = await goalFormOptions(viewers.long);
    expect(asLong.levels).toEqual(["department", "team", "individual"]);
    expect(asLong.departments.map((department) => department.name)).toEqual(["Video"]);
    expect(asLong.people.map((person) => person.name)).toEqual(["huy", "linh", "long", "ngo", "tam"]);
    expect((await goalFormOptions(viewers.ceo)).levels).toEqual(["group", "entity", "department", "team", "individual"]);
    const asHr = await goalFormOptions(viewers.hrSzm);
    expect(asHr.levels).toEqual(["entity", "department", "team", "individual"]);
    expect(asHr.entities.map((entity) => entity.name)).toEqual(["Media"]);
    expect(asHr.people.map((person) => person.name)).not.toContain("khoi");
  });

  it("resolves where a draft would sit, so the action can refuse before anything is written", async () => {
    const forKhoi = await resolveDraft(draft({ level: "individual", personId: ids.khoi }));
    expect(canEditGoal(viewers.long.principal, forKhoi!.parties)).toBe(false);
    expect(canEditGoal(viewers.chi.principal, forKhoi!.parties)).toBe(true);
    const team = await resolveDraft(draft({ level: "team", teamId: ids.crew, ownerPersonId: ids.tam }));
    expect(team?.values).toMatchObject({ departmentId: ids.vid, teamId: ids.crew, personId: null });
    expect(await resolveDraft(draft({ level: "entity", entityId: "00000000-0000-4000-8000-000000000000", ownerPersonId: ids.ceo }))).toBeNull();
    expect(await resolveDraft(draft({ level: "department", departmentId: null, ownerPersonId: ids.ceo }))).toBeNull();
  });
});

describe("check-ins and the roll-up", () => {
  it("starts at the start value and at nothing where nothing is measured", async () => {
    const loaded = await loadGoal(viewers.huy, goals.huy);
    expect(loaded?.goal.progress).toMatchObject({ progressBp: 0, source: "key_results", confidence: null });
    expect(loaded?.goal.keyResults.map((keyResult) => [keyResult.currentValue, keyResult.stale])).toEqual([[0, true], [400, true], [0, true]]);
    expect((await loadGoal(viewers.huy, goals.group))?.goal.progress).toMatchObject({ progressBp: 0, source: "children" }); // SZM's revenue stands at its start
    expect((await loadGoal(viewers.tam, goals.ngo))?.goal.progress).toMatchObject({ progressBp: null, source: "none" });
  });

  it("appends a check-in, moves the key result and every figure above it", async () => {
    const monday = new Date("2027-02-08T02:00:00Z");
    await createCheckIn(viewers.huy, krs.huyVideos, { value: "10", doneMilestones: [], confidence: "on_track", note: "Tết slowed us down" }, monday);
    await createCheckIn(viewers.huy, krs.huyRounds, { value: "3,5", doneMilestones: [], confidence: "at_risk", note: null }, new Date("2027-02-08T02:05:00Z"));
    await createCheckIn(viewers.tam, krs.huyCourse, { value: null, doneMilestones: [0, 1], confidence: "on_track", note: null }, new Date("2027-02-10T02:00:00Z"));
    const loaded = await loadGoal(viewers.tam, goals.huy, new Date("2027-02-12T00:00:00Z"));
    // (2 × 25 % + 1 × 25 % + 1 × 50 %) / 4 = 31.25 %
    expect(loaded?.goal.progress).toMatchObject({ progressBp: 3125, confidence: "at_risk", source: "key_results" });
    expect(loaded?.goal.keyResults.map((keyResult) => [keyResult.currentValue, keyResult.progressBp, keyResult.confidence, keyResult.stale])).toEqual([[1000, 2500, "on_track", false], [350, 2500, "at_risk", false], [2, 5000, "on_track", false]]);
    expect(loaded?.checkIns.map((checkIn) => [checkIn.keyResultTitle, checkIn.authorName, checkIn.weekStart, checkIn.value])).toEqual([["Colour grading course", "tam", "2027-02-08", 2], ["Revision rounds per video", "huy", "2027-02-08", 350], ["Videos delivered", "huy", "2027-02-08", 1000]] /* newest first */);
    // Crew A and VID have no key results: they take their children's figure. SZM has its own (revenue): children do not move it.
    expect((await loadGoal(viewers.linh, goals.crew))?.goal.progress).toMatchObject({ progressBp: 3125, source: "children", confidence: "at_risk" });
    expect((await loadGoal(viewers.linh, goals.vid))?.goal.progress.progressBp).toBe(3125);
    expect((await loadGoal(viewers.linh, goals.szm))?.goal.progress).toMatchObject({ progressBp: 0, source: "key_results" });
    // The colleague sees the department's number, never what it is made of.
    expect((await loadGoal(viewers.linh, goals.crew))?.lineTitles).toEqual({});
  });

  it("refuses values it cannot read, check-ins on goals that are not running, and any change to the log", async () => {
    expect(await fails(createCheckIn(viewers.huy, krs.huyVideos, { value: "ten", doneMilestones: [], confidence: "on_track", note: null }))).toBe("bad_value");
    const kr = await saveKeyResult(goals.huyDraft, null, numberKr("x", "0", "1"));
    expect(await fails(createCheckIn(viewers.huy, kr.after.id, { value: "1", doneMilestones: [], confidence: "on_track", note: null }))).toBe("goal_not_active");
    await expect(db().execute(sql`update goal_check_in set value = 1`)).rejects.toThrow();
    await expect(db().execute(sql`delete from goal_check_in`)).rejects.toThrow();
  });

  it("keeps a key result that has a history, and its unit", async () => {
    expect(await fails(removeKeyResult(krs.huyVideos))).toBe("key_result_has_check_ins");
    expect(await fails(saveKeyResult(goals.huy, krs.huyVideos, { ...numberKr("Videos delivered", "0", "40"), metricType: "currency" }))).toBe("metric_type_fixed");
    // The target may move (audited); what was achieved stays.
    const { after } = await saveKeyResult(goals.huy, krs.huyVideos, numberKr("Videos delivered", "0", "50", 2));
    expect([after.targetValue, after.currentValue]).toEqual([5000, 1000]);
    await saveKeyResult(goals.huy, krs.huyVideos, numberKr("Videos delivered", "0", "40", 2));
    const spare = await saveKeyResult(goals.huy, null, numberKr("Spare", "0", "1"));
    expect((await removeKeyResult(spare.after.id)).title).toBe("Spare");
    expect(await fails(saveKeyResult(goals.huy, null, { title: "m", metricType: "milestone", startValue: null, targetValue: null, milestones: [], weight: 1 }))).toBe("milestones_required");
    expect(await fails(saveKeyResult(goals.huy, null, numberKr("bad", "0", "many")))).toBe("bad_target_value");
  });
});

describe("the tree", () => {
  it("keeps parents above their children, inside the year and free of loops", async () => {
    expect(await fails(createGoal(viewers.ceo, draft({ title: "upside down", ownerPersonId: ids.ceo, parentGoalId: goals.szm })))).toBe("parent_below_child");
    expect(await fails(createGoal(viewers.huy, draft({ level: "individual", personId: ids.huy, periodKey: "2028", parentGoalId: goals.crew })))).toBe("parent_not_found");
    expect(await fails(createGoal(viewers.huy, draft({ level: "individual", personId: ids.huy, periodKey: "2027-Q2", parentGoalId: goals.huy })))).toBe("parent_other_period");
    expect(await fails(createGoal(viewers.chi, draft({ level: "individual", personId: ids.khoi, parentGoalId: goals.huy })))).toBe("parent_not_found"); // a parent she may not see
    expect(await fails(createGoal(viewers.huy, draft({ level: "individual", personId: ids.huy, periodKey: "Q1" })))).toBe("bad_period");
    const second = await createGoal(viewers.huy, draft({ level: "individual", personId: ids.huy, title: "Huy: second", periodKey: "2027-Q1", parentGoalId: goals.huy, activate: false }));
    expect(await fails(reparentGoal(viewers.huy, goals.huy, second.id))).toBe("parent_is_descendant");
    expect(await fails(reparentGoal(viewers.huy, goals.huy, goals.huy))).toBe("parent_is_descendant");
    expect((await reparentGoal(viewers.huy, second.id, null)).after.parentGoalId).toBeNull();
    expect(await fails(updateGoal(goals.huy, { title: "x", description: null, periodKey: "2028-Q1", weight: 1, ownerPersonId: ids.huy }))).toBe("bad_period");
    // An individual goal stays its person's.
    expect((await updateGoal(goals.huy, { title: "Huy: edit faster", description: "Q1", periodKey: "2027-Q1", weight: 1, ownerPersonId: ids.tam })).after.ownerPersonId).toBe(ids.huy);
    await moveGoal(viewers.huy, second.id, "cancel");
  });

  it("freezes the figure at close, whatever happens afterwards", async () => {
    expect(await fails(moveGoal(viewers.tam, goals.ngo, "close"))).toBe("nothing_to_freeze");
    expect(await fails(moveGoal(viewers.tam, goals.huyDraft, "close"))).toBe("bad_transition");
    const { after } = await moveGoal(viewers.tam, goals.huy, "close");
    expect(after).toMatchObject({ status: "closed", finalProgressBp: 3125, closedByPersonId: ids.tam });
    expect(await fails(createCheckIn(viewers.huy, krs.huyVideos, { value: "40", doneMilestones: [], confidence: "on_track", note: null }))).toBe("goal_not_active");
    expect(await fails(saveKeyResult(goals.huy, krs.huyVideos, numberKr("Videos delivered", "0", "10")))).toBe("goal_not_open");
    expect(await fails(updateGoal(goals.huy, { title: "x", description: null, periodKey: "2027-Q1", weight: 1, ownerPersonId: ids.huy }))).toBe("goal_not_open");
    // Even a value changed behind the application's back does not move a closed goal.
    await db().update(schema.keyResult).set({ currentValue: 4000 }).where(eq(schema.keyResult.id, krs.huyVideos));
    expect((await loadGoal(viewers.tam, goals.huy))?.goal.progress).toEqual({ progressBp: 3125, confidence: null, source: "frozen", lines: [] });
    expect((await loadGoal(viewers.tam, goals.crew))?.goal.progress.progressBp).toBe(3125);
    await db().update(schema.keyResult).set({ currentValue: 1000 }).where(eq(schema.keyResult.id, krs.huyVideos));
  });

  it("gives Phase 8 one person's year: own goals and the units', with what is final marked", async () => {
    await createCheckIn(viewers.ceo, krs.vidRevenue, { value: "3.000.000.000", doneMilestones: [], confidence: "on_track", note: null });
    const results = await getOkrResults({ personId: ids.huy, year: YEAR });
    expect(results.individual).toEqual({ progressBp: 3125, goals: [{ goalId: goals.huy, title: "Huy: edit faster", periodKey: "2027-Q1", status: "closed", progressBp: 3125, final: true }] }); // the draft and the cancelled one are left out
    expect(results.units.team).toMatchObject({ progressBp: 3125, goals: [{ goalId: goals.crew, final: false }] });
    expect(results.units.department.progressBp).toBe(3125);
    expect(results.units.entity.progressBp).toBe(2500);
    expect(results.units.group.progressBp).toBe(2500);
    const khoi = await getOkrResults({ personId: ids.khoi, year: YEAR });
    expect(khoi.individual).toMatchObject({ progressBp: null, goals: [{ title: "Khoi: portfolio", progressBp: null, final: false }] });
    expect(khoi.units).toMatchObject({ team: { progressBp: null, goals: [] }, department: { progressBp: null, goals: [] }, entity: { progressBp: null, goals: [] }, group: { progressBp: 2500 } });
    expect((await getOkrResults({ personId: ids.huy, year: 2026 })).individual).toEqual({ progressBp: null, goals: [] });
  });

  it("lets HR take a frozen figure back, and nobody else's move through", async () => {
    const { after } = await moveGoal(viewers.hrSzm, goals.huy, "reopen");
    expect(after).toMatchObject({ status: "active", finalProgressBp: null, closedAt: null });
    expect(await fails(moveGoal(viewers.hrSzm, goals.huy, "reopen"))).toBe("bad_transition");
  });
});
