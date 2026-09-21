// Intake forms against a real Postgres (PGlite): who may ask, where the request lands, who sees it.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
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

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { findIntakeForm, listMyIntakeRequests, listOpenIntakeForms, listTeamIntakeForms, saveIntakeForm, submitIntake } from "./intake";
import { canSubmitIntake, canViewTask } from "./policy";
import { createProject } from "./projects";
import { followersOf } from "./followers";
import { listStates, createTeam, setTeamMember, teamFacts } from "./teams";
import { listTeamBacklog, loadTask } from "./tasks";
import { viewerOfPerson } from "./viewer";

const ids = {} as Record<"szm" | "szc" | "long" | "huy" | "duc" | "khoi" | "freelancer" | "video" | "project" | "form", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error & { details?: unknown }) => ({ message: error.message, details: error.details }));
const fields = [
  { label: "Nội dung cần quay", type: "long_text" as const, required: true },
  { label: "Định dạng", type: "select" as const, required: true, options: ["Reels", "TVC"] },
  { label: "Cần trước ngày", type: "date" as const, required: false },
];

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id });
  const people = [["long", szm.id, "employee"], ["huy", szm.id, "employee"], ["duc", szm.id, "employee"], ["khoi", szc.id, "employee"], ["freelancer", szm.id, "collaborator"]] as const;
  for (const [key, entityId, workforceType] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: entityId, workforceType }).returning();
    ids[key] = row.id;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, "content", {}, ids.long);
  ids.video = video.id;
  await setTeamMember(video.id, ids.huy, "member");
  ids.project = (await createProject({ teamId: video.id, name: "Yêu cầu nội bộ", description: null, clientId: null, status: "active", visibility: "private", leadPersonId: ids.long, startDate: null, dueDate: null }, ids.long)).id;
});

describe("intake forms", () => {
  it("a form needs sound questions and a project of its own team", async () => {
    expect(await fails(saveIntakeForm(ids.video, null, { name: "Yêu cầu quay dựng", description: null, projectId: null, audience: "entity", fields: [], isActive: true }, ids.long))).toMatchObject({ message: "intake_fields_required" });
    expect(await fails(saveIntakeForm(ids.video, null, { name: "X", description: null, projectId: null, audience: "entity", fields: [{ label: "Chọn", type: "select", required: true, options: ["một"] }], isActive: true }, ids.long))).toMatchObject({ message: "intake_select_needs_options" });
    expect(await fails(saveIntakeForm(ids.video, null, { name: "X", description: null, projectId: "00000000-0000-4000-8000-000000000000", audience: "entity", fields, isActive: true }, ids.long))).toMatchObject({ message: "project_not_found" });
    const { after } = await saveIntakeForm(ids.video, null, { name: "Yêu cầu quay dựng", description: "Gửi trước ít nhất 5 ngày", projectId: ids.project, audience: "entity", fields, isActive: true }, ids.long);
    ids.form = after.id;
    expect(after.fields.map((field) => field.key)).toEqual(["f1", "f2", "f3"]);
  });

  it("is open to the team's entity and its members — not to other entities, not to collaborators", async () => {
    const team = teamFacts((await findIntakeForm(ids.form))!.team);
    const viewers = Object.fromEntries(await Promise.all((["long", "huy", "duc", "khoi", "freelancer"] as const).map(async (key) => [key, (await viewerOfPerson(db(), ids[key]))!] as const)));
    expect(Object.entries(viewers).map(([key, viewer]) => [key, canSubmitIntake(viewer, team, "entity")])).toEqual([["long", true], ["huy", true], ["duc", true], ["khoi", false], ["freelancer", false]]);
    // A form opened to the group lets the sister company in — still not the collaborator.
    expect(Object.entries(viewers).map(([key, viewer]) => [key, canSubmitIntake(viewer, team, "group")])).toEqual([["long", true], ["huy", true], ["duc", true], ["khoi", true], ["freelancer", false]]);
    expect((await listOpenIntakeForms(viewers.duc)).map((form) => form.name)).toEqual(["Yêu cầu quay dựng"]);
    expect(await listOpenIntakeForms(viewers.khoi)).toEqual([]);
    expect(await listOpenIntakeForms(viewers.freelancer)).toEqual([]);
  });

  it("refuses bad answers with every problem at once", async () => {
    expect(await fails(submitIntake(ids.form, { title: "Clip 20/10", answers: { f2: "Poster", f3: "20/10" } }, { personId: ids.duc, fullName: "Duc" }))).toEqual({ message: "intake_answers_invalid", details: { problems: [{ key: "f1", problem: "required" }, { key: "f2", problem: "not_an_option" }, { key: "f3", problem: "not_a_date" }] } });
  });

  it("a request lands in the backlog with the requester set; the requester sees and follows it, another outsider does not; the leads are told", async () => {
    const sent = await submitIntake(ids.form, { title: "Clip 20/10", answers: { f1: "Clip chúc mừng 20/10", f2: "Reels", f3: "2026-10-15" } }, { personId: ids.duc, fullName: "Duc" });
    expect(sent.key).toBe("VID-1");
    const loaded = (await loadTask(sent.taskId))!;
    expect(loaded.task).toMatchObject({ requesterPersonId: ids.duc, assigneePersonId: null, dueDate: "2026-10-15", status: "todo", description: "[Yêu cầu quay dựng]\n\nNội dung cần quay:\nClip chúc mừng 20/10\n\nĐịnh dạng: Reels\n\nCần trước ngày: 15/10/2026" });
    expect(loaded.work).toMatchObject({ projectId: ids.project, intakeFormId: ids.form });
    expect((await listStates([ids.video])).find((state) => state.id === loaded.work.stateId)!.category).toBe("backlog");

    // The project is private: the requester still sees their own request, and only that.
    const [duc, khoi, huy] = await Promise.all([viewerOfPerson(db(), ids.duc), viewerOfPerson(db(), ids.khoi), viewerOfPerson(db(), ids.huy)]);
    expect(canViewTask(duc!, loaded.facts)).toBe(true);
    expect(canViewTask(khoi!, loaded.facts)).toBe(false);
    expect(canViewTask(huy!, loaded.facts)).toBe(false);
    expect(followersOf(loaded)).toEqual([ids.duc]);

    const notices = await db().select().from(schema.notification).where(and(eq(schema.notification.kind, "tasks.intake_submitted")));
    expect(notices.map((row) => row.recipientPersonId)).toEqual([ids.long]);
    expect((await listMyIntakeRequests(ids.duc)).map((row) => [row.key, row.formName])).toEqual([["VID-1", "Yêu cầu quay dựng"]]);
    expect((await listTeamIntakeForms(ids.video)).map((form) => form.submissions)).toEqual([1]);
    expect(await listTeamBacklog(ids.video)).toEqual([]);
  });

  it("a closed form takes no more requests", async () => {
    await saveIntakeForm(ids.video, ids.form, { name: "Yêu cầu quay dựng", description: null, projectId: ids.project, audience: "group", fields, isActive: false }, ids.long);
    expect(await fails(submitIntake(ids.form, { title: "x", answers: { f1: "x", f2: "TVC" } }, { personId: ids.duc, fullName: "Duc" }))).toMatchObject({ message: "intake_form_not_found" });
  });
});
