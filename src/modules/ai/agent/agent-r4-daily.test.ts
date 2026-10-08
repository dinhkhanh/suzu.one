// Phase 13 R4 on the asker's own day, against a real Postgres (PGlite): log time, plan a task for
// today, send the end-of-day report. Each proposal is confirmed through the REAL action pipeline —
// `ai.proposal.confirm` calling the daily module's own exported action — with only the session and
// Next's cache stubbed; each refusal is a card that would have failed at Xác nhận, never made.
//
// The cast: Long leads the Video team; Huy and Tâm work in it; Khoa is outside it.
import { beforeAll, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", EMBEDDINGS_MODEL: "@cf/baai/bge-m3" }), isDevelopmentEnvironment: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => session.user, requireUser: async () => session.user }));

import { and, eq } from "drizzle-orm";
import { addDays, todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { createWorkTask } from "@/modules/work/tasks";
import { createTeam, setTeamMember } from "@/modules/work/teams";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { workflow } from "../../../../tests/helpers/workflows";
import { confirmProposalAction } from "../proposal-actions";
import { type AnyAgentTool, runAgentTool } from "./registry";
import { PROPOSE_DAILY_TOOLS } from "./tools/propose-daily";

type Who = "long" | "huy" | "tam" | "khoa";
const ids = {} as Record<Who | "rough" | "mix" | "tamTask", string>;
const users = {} as Record<Who, CurrentUser>;
const today = todayInVietnam();
const NAMES: Record<Who, string> = { long: "Dang Hoang Long", huy: "Ho Gia Huy", tam: "Bui Thanh Tam", khoa: "Vu Dang Khoa" };

const tool = (name: string): AnyAgentTool => PROPOSE_DAILY_TOOLS.find((candidate) => candidate.name === name)!;
const run = (who: Who, name: string, input: unknown) => runAgentTool(tool(name), { user: users[who], today, locale: "vi" }, input);
const confirm = async (who: Who, result: Awaited<ReturnType<typeof run>>) => {
  session.user = users[who];
  return confirmProposalAction({ id: result.card?.proposal?.id ?? "" });
};
const timeOf = (who: Who) => db().select().from(schema.timeEntry).where(eq(schema.timeEntry.personId, ids[who]));

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  for (const who of Object.keys(NAMES) as Who[]) {
    const [row] = await db()
      .insert(schema.person)
      .values({ fullName: NAMES[who], searchName: NAMES[who].toLowerCase(), workEmail: `${who}@suzu.group`, status: "active", primaryEntityId: szm.id })
      .returning();
    ids[who] = row.id;
    users[who] = {
      userId: `user-${who}`,
      sessionId: `session-${who}`,
      reauthAt: null,
      preferences: { locale: null, theme: null, navPins: [] },
      email: `${who}@suzu.group`,
      name: NAMES[who],
      image: null,
      person: row,
      impersonator: null,
      principal: { personId: row.id, workforceType: "employee", grants: [] },
      request: { ipAddress: null, userAgent: null },
    } as CurrentUser;
  }
  const video = await createTeam({ key: "VID", name: "Video Production", description: null, entityId: szm.id, departmentId: null, defaultVisibility: "team", isActive: true }, workflow("simple"), ids.long);
  for (const who of ["huy", "tam"] as const) await setTeamMember(video.id, ids[who], "member");
  ids.rough = (await createWorkTask({ teamId: video.id, title: "Rough cut", assigneePersonId: ids.huy, requesterPersonId: ids.long }, ids.long)).task.id;
  ids.mix = (await createWorkTask({ teamId: video.id, title: "Mix âm thanh", assigneePersonId: ids.huy }, ids.long)).task.id;
  ids.tamTask = (await createWorkTask({ teamId: video.id, title: "Color grading", assigneePersonId: ids.tam }, ids.long)).task.id;
}, 120_000);

describe("propose_time_log → daily.time.log", () => {
  it("logs time on a task once confirmed, and not before", async () => {
    const result = await run("huy", "propose_time_log", { task: "VID-1", minutes: 90 });
    expect(result.outcome).toBe("proposed");
    const proposal = result.card?.proposal;
    expect(proposal?.action).toBe("daily.time.log");
    expect(proposal?.fields.map((field) => field.key)).toEqual(["task", "date", "duration"]);
    expect(proposal?.fields[2]).toMatchObject({ valueKey: "duration", params: { hours: 1.5, minutes: 90 } });
    expect(proposal?.editHref).toBe(`/work/tasks/${ids.rough}`);
    expect(await timeOf("huy")).toHaveLength(0);
    expect(await confirm("huy", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    expect(await timeOf("huy")).toEqual([expect.objectContaining({ taskId: ids.rough, minutes: 90, date: today })]);
  });

  it("logs time on no task, under a category, on a past day", async () => {
    const yesterday = addDays(today, -1);
    const result = await run("tam", "propose_time_log", { category: "admin", minutes: 30, date: yesterday, note: "Họp giao ban" });
    expect(result.card?.proposal?.fields.map((field) => field.key)).toEqual(["category", "date", "duration", "note"]);
    expect(result.card?.proposal?.editHref).toMatch(/^\/daily\/time\?week=\d{4}-\d{2}-\d{2}$/u);
    expect(await confirm("tam", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    expect(await timeOf("tam")).toEqual([expect.objectContaining({ taskId: null, category: "admin", minutes: 30, date: yesterday, note: "Họp giao ban" })]);
  });

  it("refuses a day outside the window, a task the asker cannot see, and neither-or-both", async () => {
    expect((await run("huy", "propose_time_log", { task: "VID-1", minutes: 60, date: addDays(today, 1) })).model).toMatchObject({ reason: "outside_time_window" });
    expect((await run("huy", "propose_time_log", { task: "VID-1", minutes: 60, date: addDays(today, -60) })).model).toMatchObject({ reason: "outside_time_window" });
    expect((await run("khoa", "propose_time_log", { task: "VID-1", minutes: 60 })).model).toMatchObject({ reason: "task_not_found" });
    expect((await run("khoa", "propose_time_log", { task: ids.rough, minutes: 60 })).model).toMatchObject({ reason: "task_not_found" });
    expect((await run("huy", "propose_time_log", { minutes: 60 })).model).toMatchObject({ reason: "task_or_category" });
    expect((await run("huy", "propose_time_log", { task: "VID-1", category: "admin", minutes: 60 })).card).toBeNull();
  });
});

describe("propose_plan_today → daily.plan.add", () => {
  it("adds the asker's own open task to today's plan once confirmed, and only once", async () => {
    const result = await run("huy", "propose_plan_today", { task: "Mix" });
    expect(result.outcome).toBe("proposed");
    expect(result.card?.proposal?.editHref).toBe("/daily/plan");
    expect(result.card?.proposal?.fields.map((field) => field.key)).toEqual(["task", "date"]);
    expect(await confirm("huy", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [plan] = await db()
      .select()
      .from(schema.dailyPlan)
      .where(and(eq(schema.dailyPlan.personId, ids.huy), eq(schema.dailyPlan.date, today)));
    expect(plan.items.map((item) => item.taskId)).toEqual([ids.mix]);
    expect((await run("huy", "propose_plan_today", { task: "VID-2" })).model).toMatchObject({ reason: "already_in_plan" });
  });

  it("refuses a teammate's task and a task outside the asker's work", async () => {
    expect((await run("huy", "propose_plan_today", { task: "VID-3" })).model).toMatchObject({ reason: "not_your_open_work" });
    expect((await run("khoa", "propose_plan_today", { task: "Rough cut" })).model).toMatchObject({ reason: "not_your_open_work" });
    expect((await run("tam", "propose_plan_today", { task: ids.rough })).card).toBeNull();
  });
});

describe("propose_eod_report → daily.report.submit", () => {
  it("drafts the notes from the day, tells the lead of the blockers, and sends once confirmed", async () => {
    const result = await run("huy", "propose_eod_report", { blockers: "Chờ nhạc từ khách", tomorrow: ["Rough cut"] });
    expect(result.outcome).toBe("proposed");
    const proposal = result.card?.proposal;
    expect(proposal?.fields.map((field) => field.key)).toEqual(["date", "notes", "source", "blockers", "tomorrow"]);
    expect(proposal?.fields.find((field) => field.key === "notes")?.text).toBeTruthy();
    expect(proposal?.notify).toEqual([NAMES.long]);
    expect(proposal?.editHref).toBe(`/daily/report?date=${today}&proposal=${proposal?.id}`);
    expect(await db().select().from(schema.dailyReport).where(eq(schema.dailyReport.personId, ids.huy))).toHaveLength(0);

    expect(await confirm("huy", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [report] = await db().select().from(schema.dailyReport).where(eq(schema.dailyReport.personId, ids.huy));
    expect(report).toMatchObject({ date: today, status: "submitted", blockers: "Chờ nhạc từ khách" });
    expect(report.notes).toBeTruthy();
    expect(report.tomorrow.map((item) => item.taskId)).toEqual([ids.rough]);
    const told = await db()
      .select()
      .from(schema.notification)
      .where(and(eq(schema.notification.recipientPersonId, ids.long), eq(schema.notification.kind, "daily.report_blockers")));
    expect(told).toHaveLength(1);
  });

  it("refuses a report already sent, so the person's words are not written over", async () => {
    expect((await run("huy", "propose_eod_report", { notes: "Lần hai" })).model).toMatchObject({ reason: "report_already_submitted" });
  });

  it("takes the asker's own words, tells nobody without blockers", async () => {
    const result = await run("tam", "propose_eod_report", { notes: "Xong phần màu cảnh 1." });
    expect(result.card?.proposal?.fields.map((field) => field.key)).toEqual(["date", "notes", "tomorrow"]);
    expect(result.card?.proposal?.notify).toEqual([]);
    expect(await confirm("tam", result)).toMatchObject({ ok: true, data: { state: "confirmed" } });
    const [report] = await db().select().from(schema.dailyReport).where(eq(schema.dailyReport.personId, ids.tam));
    expect(report.notes).toBe("Xong phần màu cảnh 1.");
  });

  it("refuses a day outside the window, and keeps a task that is not the asker's for tomorrow as words, never as a task", async () => {
    expect((await run("khoa", "propose_eod_report", { date: addDays(today, -10), notes: "x" })).model).toMatchObject({ reason: "outside_report_window" });
    expect((await run("khoa", "propose_eod_report", { date: addDays(today, 1), notes: "x" })).model).toMatchObject({ reason: "outside_report_window" });
    const result = await run("khoa", "propose_eod_report", { notes: "x", tomorrow: ["Rough cut"] });
    expect(result.outcome).toBe("proposed");
    const [row] = await db().select().from(schema.aiProposal).where(eq(schema.aiProposal.id, result.card!.proposal!.id));
    expect(row.input).toMatchObject({ notes: "x\nNgày mai: Rough cut", tomorrow: [] });
  });
});
