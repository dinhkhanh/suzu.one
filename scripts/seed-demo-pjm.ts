// Phase 10 demo data (projects & daily work management) on top of the demo company, local only.
// It goes through the app's own services — the brief through the kick-off gate, hand-offs through
// the transition gate, the client decision through the review chain, the acceptance to its billing
// item — so the rows are what the screens would have written. The services `import "server-only"`;
// the package script loads scripts/server-only-shim.cjs so plain Node can run them.
//
// The two pilot teams (SRS Q24): Video Production (VID) runs the TVC for Sữa Mộc An through
// kick-off; Creative & Social (CRS) runs the Trà Lá Xanh fanpage retainer. Also: bookings with a
// placeholder, two weeks of time with one week approved and one waiting, a week of plans and EOD
// reports (one missing, one late), a pending, a returned and a cross-team hand-off, a blocker, a
// change request approved with its fee, a signed acceptance and its billing item, a publish log
// with results, a risk log, a meeting with action items and two automations.
//
// Order: `pnpm db:seed && pnpm db:seed:demo`, then `pnpm db:seed:demo:pjm`. Idempotent: skipped once
// any project status update exists. Afterwards run the cron schedules once (midnight, morning) on a
// dev server so the retainer month, cover plans, cycles and reminders exist.
import { config } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { addDays, todayInVietnam } from "../src/lib/dates";
import { db, schema } from "../src/lib/db";
import { DEFAULT_TEAM_RULES, weekStartOf } from "../src/modules/daily/engine/rules";
import { loadReportReader } from "../src/modules/daily/people";
import { savePlan } from "../src/modules/daily/plans";
import { submitReport } from "../src/modules/daily/reports";
import { saveTeamRules } from "../src/modules/daily/team-rules";
import { logTime } from "../src/modules/daily/time";
import { decideWeek, submitWeek } from "../src/modules/daily/timesheets";
import { createAcceptance, sendAcceptance, signAcceptance } from "../src/modules/projects/acceptance";
import { bookWeeks } from "../src/modules/projects/bookings";
import { decideChange, saveChange, submitChange } from "../src/modules/projects/change-requests";
import { decideBrief, submitBrief } from "../src/modules/projects/kickoff";
import { saveMeeting } from "../src/modules/projects/meetings";
import { ensurePlan, setAccountManager, setFee, updateBrief, updatePlanSettings } from "../src/modules/projects/plans";
import { saveRaidItem } from "../src/modules/projects/raid-log";
import { runRetainers, saveRetainer } from "../src/modules/projects/retainers";
import { postStatusUpdate } from "../src/modules/projects/status-updates";
import { createTasksForLine, linkTask, saveDeliverable, saveMilestone, savePhase, setMilestoneDone } from "../src/modules/projects/structure";
import { addPresetAutomation } from "../src/modules/work/automations";
import { raiseBlocker } from "../src/modules/work/blockers";
import { saveReviewChain } from "../src/modules/work/chains";
import { recordDelivery } from "../src/modules/work/deliveries";
import { acceptHandoff, handOffStage, returnHandoff, savePackage, sendToTeam } from "../src/modules/work/handoffs";
import { createProject, setProjectMember } from "../src/modules/work/projects";
import { markPublished, planPublish, recordResult } from "../src/modules/work/publish";
import { decideStage, submitDeliverable } from "../src/modules/work/reviews";
import { createWorkTask, updateWorkTask } from "../src/modules/work/tasks";

config({ path: ".env.local" });

const EMAILS = {
  long: "long.dang@suzu.group",
  tam: "tam.bui@suzu.group",
  huy: "huy.ho@suzu.group",
  linh: "linh.do@suzu.group",
  chi: "chi.duong@suzu.group",
  duc: "duc.phan@suzu.group",
  duyen: "duyen.huynh@suzu.group",
  khoi: "khoi.ly@suzu.group",
  anh: "anh.trinh@suzu.group",
  tuan: "tuan.vo@suzu.group",
} as const;
type Key = keyof typeof EMAILS;

/** A time of day in Vietnam on a date: the moment a report was sent. */
const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set (see .env.example)");
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname) && process.env.DEMO_SEED_ALLOW_REMOTE !== "1") throw new Error("Demo data is for a local database only (set DEMO_SEED_ALLOW_REMOTE=1 for a staging database).");

  const [seeded] = await db().select({ id: schema.projectStatusUpdate.id }).from(schema.projectStatusUpdate).limit(1);
  if (seeded) {
    console.log("PJM demo data already exists (a project status update is there): nothing to do.");
    return;
  }

  const today = todayInVietnam();
  const people = await db().select({ id: schema.person.id, email: schema.person.workEmail, fullName: schema.person.fullName, workforceType: schema.person.workforceType, entityId: schema.person.primaryEntityId, orgUnitId: schema.person.orgUnitId }).from(schema.person);
  const id = {} as Record<Key, string>;
  const name = {} as Record<Key, string>;
  for (const [key, email] of Object.entries(EMAILS) as [Key, string][]) {
    const row = people.find((candidate) => candidate.email === email);
    if (!row) throw new Error(`${email} is missing: run \`pnpm db:seed:demo\` first.`);
    id[key] = row.id;
    name[key] = row.fullName;
  }
  const actor = (key: Key) => ({ personId: id[key], fullName: name[key] });
  const teams = new Map((await db().select().from(schema.workTeam)).map((row) => [row.key, row]));
  const [vid, crs] = [teams.get("VID"), teams.get("CRS")];
  if (!vid || !crs) throw new Error("The demo work teams are missing: run `pnpm db:seed:demo` first.");
  const states = await db().select().from(schema.workState).where(inArray(schema.workState.teamId, [vid.id, crs.id]));
  const state = (teamId: string, stateName: string) => states.find((row) => row.teamId === teamId && row.name === stateName)!.id;
  const projects = await db().select().from(schema.workProject);
  const projectNamed = (prefix: string) => projects.find((row) => row.name.startsWith(prefix))!;
  const clients = new Map((await db().select().from(schema.workClient)).map((row) => [row.code, row]));
  const entities = new Map((await db().select().from(schema.entity)).map((row) => [row.code, row]));

  // ── People the personas need ─────────────────────────────────────────────────────────────
  // An entity director for SuZu Media (none in the base demo), and a sign-in for the collaborator.
  const szm = entities.get("SZM")!;
  let director = people.find((row) => row.email === "quan.truong@suzu.group");
  if (!director) {
    const board = people.find((row) => row.email === "ha.nguyen@suzu.vn")?.orgUnitId ?? null;
    const [row] = await db().insert(schema.person).values({ fullName: "Trương Minh Quân", searchName: "truong minh quan", workEmail: "quan.truong@suzu.group", status: "active", primaryEntityId: szm.id, orgUnitId: board }).returning();
    await db().insert(schema.roleAssignment).values({ personId: row.id, role: "entity_director", scopeType: "entity", scopeId: szm.id, validFrom: "2024-01-01" });
    director = { id: row.id, email: row.workEmail, fullName: row.fullName, workforceType: row.workforceType, entityId: row.primaryEntityId, orgUnitId: row.orgUnitId };
  }
  const collaborator = people.find((row) => row.workforceType === "collaborator" && row.entityId === szm.id);
  if (collaborator && !collaborator.email) await db().update(schema.person).set({ workEmail: "anh.ngo@suzu.group" }).where(eq(schema.person.id, collaborator.id));

  // ── Team rules: VID logs time and has its weeks approved, in two-week cycles ───────────────
  await saveTeamRules(vid.id, { ...DEFAULT_TEAM_RULES, planMode: "required", timeMode: "required", timesheetApproval: true, cycleWeeks: 2, cycleStart: "2026-09-07" });
  await saveTeamRules(crs.id, { ...DEFAULT_TEAM_RULES });

  // ── The client project: TVC Tết 2027 — Sữa Mộc An, through kick-off ──────────────────────
  const tvc = projectNamed("TVC Tết 2027");
  await ensurePlan(tvc.id);
  await updatePlanSettings(tvc.id, { kind: "client", budgetMinutes: null, budgetByRole: [{ role: "Đạo diễn", minutes: 40 * 60 }, { role: "Quay phim", minutes: 60 * 60 }, { role: "Dựng phim", minutes: 80 * 60 }, { role: "Chỉnh màu", minutes: 20 * 60 }], updateCadenceDays: 7, driveUrl: "https://drive.google.com/drive/folders/tvc-tet-2027-mocan" });
  await setAccountManager(tvc.id, id.duc);
  await setFee(tvc.id, 180_000_000);
  if (collaborator) await setProjectMember(tvc.id, collaborator.id, "member");
  await updateBrief(tvc.id, {
    objective: "TVC Tết 2027 cho Sữa Mộc An: gắn sản phẩm với khoảnh khắc sum họp ba thế hệ.",
    scopeIn: "1 TVC 30 giây, 2 bản cắt 15 giây và 6 giây, key visual Tết cho fanpage.",
    scopeOut: "Mua media, in ấn POSM.",
    successCriteria: "Khách duyệt kịch bản trong hai vòng; phát sóng từ 15/01/2027.",
    audience: "Gia đình thành thị 28–45 tuổi.",
    keyMessages: "Mộc An — vị sữa của nhà.",
    clientContacts: [{ name: "Chị Mai Phương", role: "Brand manager", contact: "mai.phuong@mocan.vn" }],
    links: ["https://drive.google.com/drive/folders/tvc-tet-2027-brief"],
  });
  const prePro = (await savePhase(tvc.id, null, { name: "Tiền kỳ", startDate: "2026-09-01", endDate: "2026-10-05", budgetMinutes: 60 * 60, sortOrder: 0 })).after;
  const shoot = (await savePhase(tvc.id, null, { name: "Sản xuất", startDate: "2026-10-06", endDate: "2026-10-15", budgetMinutes: 70 * 60, sortOrder: 1 })).after;
  const post = (await savePhase(tvc.id, null, { name: "Hậu kỳ", startDate: "2026-10-16", endDate: "2026-11-05", budgetMinutes: 70 * 60, sortOrder: 2 })).after;
  const scriptMilestone = (await saveMilestone(tvc.id, null, { name: "Chốt kịch bản và dự toán", dueDate: "2026-09-19", phaseId: prePro.id, ownerPersonId: id.tam, isClientFacing: true, isBilling: true, billingAmountVnd: 54_000_000, sortOrder: 0 })).after;
  const shootMilestone = (await saveMilestone(tvc.id, null, { name: "Hoàn tất quay", dueDate: "2026-10-12", phaseId: shoot.id, ownerPersonId: id.tam, isClientFacing: false, isBilling: false, sortOrder: 1 })).after;
  const masterMilestone = (await saveMilestone(tvc.id, null, { name: "Bàn giao master", dueDate: "2026-11-05", phaseId: post.id, ownerPersonId: id.tam, isClientFacing: true, isBilling: true, billingAmountVnd: 126_000_000, sortOrder: 2 })).after;
  const scriptLine = (await saveDeliverable(tvc.id, null, { title: "Kịch bản phân cảnh 30 giây", quantity: 1, format: null, channel: null, dueDate: "2026-09-18", milestoneId: scriptMilestone.id, sortOrder: 0 })).after;
  const budgetLine = (await saveDeliverable(tvc.id, null, { title: "Dự toán sản xuất", quantity: 1, format: null, channel: null, dueDate: "2026-09-19", milestoneId: scriptMilestone.id, sortOrder: 1 })).after;
  const masterLine = (await saveDeliverable(tvc.id, null, { title: "TVC 30 giây (master)", quantity: 1, format: "tvc", channel: "youtube", dueDate: "2026-11-05", milestoneId: masterMilestone.id, sortOrder: 2 })).after;
  const cutsLine = (await saveDeliverable(tvc.id, null, { title: "Bản cắt 15 giây và 6 giây", quantity: 2, format: "short_video", channel: "tiktok", dueDate: "2026-11-05", milestoneId: masterMilestone.id, sortOrder: 3 })).after;
  // The demo's existing tasks on the lines and phases they belong to.
  const tvcTasks = await db().select({ id: schema.task.id, title: schema.task.title }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(eq(schema.workTask.projectId, tvc.id));
  const taskNamed = (prefix: string) => tvcTasks.find((row) => row.title.startsWith(prefix))?.id;
  const links: [string | undefined, { milestoneId: string | null; deliverableId: string | null; phaseId: string | null }][] = [
    [taskNamed("Kịch bản phân cảnh"), { milestoneId: scriptMilestone.id, deliverableId: scriptLine.id, phaseId: prePro.id }],
    [taskNamed("Dự toán sản xuất"), { milestoneId: scriptMilestone.id, deliverableId: budgetLine.id, phaseId: prePro.id }],
    [taskNamed("Storyboard"), { milestoneId: null, deliverableId: null, phaseId: prePro.id }],
    [taskNamed("Casting"), { milestoneId: null, deliverableId: null, phaseId: prePro.id }],
    [taskNamed("Khảo sát bối cảnh"), { milestoneId: null, deliverableId: null, phaseId: prePro.id }],
    [taskNamed("Quay chính"), { milestoneId: shootMilestone.id, deliverableId: null, phaseId: shoot.id }],
    [taskNamed("Dựng bản offline"), { milestoneId: masterMilestone.id, deliverableId: masterLine.id, phaseId: post.id }],
    [taskNamed("Chỉnh màu"), { milestoneId: masterMilestone.id, deliverableId: masterLine.id, phaseId: post.id }],
    [taskNamed("Bản cắt 15"), { milestoneId: masterMilestone.id, deliverableId: cutsLine.id, phaseId: post.id }],
  ];
  for (const [taskId, link] of links) if (taskId) await linkTask(tvc.id, taskId, link);

  // The kick-off gate: the account manager sends the brief, the team lead approves (baseline taken).
  const { requestId: briefRequest } = await submitBrief(tvc.id, id.duc);
  await decideBrief(id.long, briefRequest, { action: "approve", comment: "Brief rõ, bắt đầu tiền kỳ." });

  // Status updates with health.
  await postStatusUpdate(tvc.id, { health: "on_track", summary: "Brief đã duyệt, kịch bản đang ở vòng duyệt của khách.", highlights: "Khách chọn hướng ý tưởng “Sum họp ba thế hệ”.", nextSteps: "Chốt dự toán, casting." }, actor("tam"));
  await postStatusUpdate(tvc.id, { health: "at_risk", summary: "Bối cảnh nhà cổ Đường Lâm chưa xác nhận được lịch; ngày quay có thể lùi 3 ngày.", highlights: "Dự toán đã gửi khách.", nextSteps: "Tìm bối cảnh dự phòng trước 26/09." }, actor("tam"));

  // Bookings, with a colorist still to be named.
  const monday = weekStartOf(today);
  await bookWeeks(tvc.id, { personId: id.huy, placeholderRole: null, weekStart: monday, minutes: 20 * 60, status: "confirmed", note: null, weeks: 4 }, actor("tam"));
  await bookWeeks(tvc.id, { personId: id.linh, placeholderRole: null, weekStart: monday, minutes: 12 * 60, status: "tentative", note: "Hỗ trợ casting", weeks: 3 }, actor("tam"));
  await bookWeeks(tvc.id, { personId: null, placeholderRole: "Chỉnh màu (freelance)", weekStart: addDays(monday, 21), minutes: 16 * 60, status: "tentative", note: "Chờ báo giá", weeks: 2 }, actor("tam"));

  // A change request from the client, with the fee: the lead approves, then finance.
  const { after: change } = await saveChange(tvc.id, null, { title: "Thêm bản cắt 10 giây cho YouTube Bumper", description: "Khách muốn thêm một bản 10 giây cho chiến dịch YouTube.", requestedBy: "client", impact: { deliverables: [{ title: "Bản cắt 10 giây (Bumper)", quantity: 1, format: "short_video", channel: "youtube" }], minutesDelta: 8 * 60, feeDeltaVnd: 12_000_000 }, evidenceFileId: null, evidenceUrl: "https://mail.google.com/mail/u/0/#inbox/mocan-bumper" }, id.duc, { withFee: true });
  const { requestId: changeRequest } = await submitChange(change.id, id.duc);
  await decideChange(id.tam, changeRequest, { action: "approve", comment: null });
  await decideChange(id.tuan, changeRequest, { action: "approve", comment: "Đồng ý phí phát sinh." });

  // The script milestone is done and signed off by the client: one billing item, the paper attached.
  await setMilestoneDone(scriptMilestone.id, true, id.tam);
  const acceptance = await createAcceptance(tvc.id, { scope: "milestone", milestoneId: scriptMilestone.id, retainerPeriodId: null }, id.duc);
  await sendAcceptance(acceptance.id);
  const [scan] = await db()
    .insert(schema.storedFile)
    .values({ bucket: process.env.STORAGE_BUCKET ?? "suzu-private", objectPath: `project_acceptance/${acceptance.id}.pdf`, fileName: "bien-ban-nghiem-thu-kich-ban.pdf", contentType: "application/pdf", sizeBytes: 182_000, ownerType: "project_acceptance", ownerId: acceptance.id, entityId: tvc.entityId, tier: "personal", status: "ready", uploadedByPersonId: id.duc })
    .returning();
  await signAcceptance(acceptance.id, { signedFileId: scan.id, signedOn: addDays(today, -2), signedByClient: "Mai Phương (Sữa Mộc An)" }, id.duc);

  // A risk, an issue and a decision; a client meeting with its decisions and action items.
  await saveRaidItem(tvc.id, null, { kind: "risk", title: "Mưa trong tuần quay ngoại cảnh", description: "Dự báo mưa 10–12/10.", ownerPersonId: id.tam, dueDate: "2026-10-05", severity: "high", decidedOn: null, evidenceUrl: null, evidenceFileId: null }, id.tam, today);
  await saveRaidItem(tvc.id, null, { kind: "issue", title: "Bối cảnh nhà cổ chưa xác nhận lịch", description: null, ownerPersonId: id.linh, dueDate: addDays(today, 4), severity: "medium", decidedOn: null, evidenceUrl: null, evidenceFileId: null }, id.tam, today);
  await saveRaidItem(tvc.id, null, { kind: "decision", title: "Chọn hướng “Sum họp ba thế hệ”", description: "Khách chọn qua email.", ownerPersonId: id.tam, dueDate: null, severity: null, decidedOn: "2026-09-10", evidenceUrl: "https://mail.google.com/mail/u/0/#inbox/mocan-idea", evidenceFileId: null }, id.tam, today);
  await saveMeeting(tvc.id, null, {
    kind: "client",
    title: "Họp khách duyệt kịch bản",
    heldOn: addDays(today, -3),
    startTime: "09:30",
    durationMinutes: 90,
    attendeeIds: [id.tam, id.duc, id.long],
    externalAttendees: "Chị Mai Phương (Mộc An)",
    agenda: "Duyệt kịch bản phân cảnh, dự toán, lịch quay.",
    notes: "Khách đồng ý kịch bản, đề nghị thêm bản 10 giây.",
    decisions: [{ title: "Kịch bản 30 giây chốt bản v3", description: null }],
    actionItems: [
      { title: "Gửi báo giá bản cắt 10 giây", assigneePersonId: id.duc, dueDate: addDays(today, 2) },
      { title: "Chốt bối cảnh dự phòng", assigneePersonId: id.linh, dueDate: addDays(today, 4) },
    ],
  }, id.tam, today);

  // ── Hand-offs on the video team ─────────────────────────────────────────────────────────
  const vidScript = state(vid.id, "Kịch bản / Nội dung");
  const vidShoot = state(vid.id, "Thiết kế / Quay");
  const vidEdit = state(vid.id, "Dựng / Chỉnh sửa");
  await savePackage(vid.id, null, { name: "Kịch bản → Quay", fromStateId: vidScript, toStateId: vidShoot, fields: [{ label: "Link kịch bản đã duyệt", type: "url", required: true }, { label: "Số ngày quay", type: "text", required: true }], checklist: [{ text: "Đã chốt danh sách cảnh quay" }, { text: "Đã gửi call sheet" }], requireLink: false, requireFile: false, requireAccept: true, isActive: true }, id.long);
  const [pkg] = await db().select().from(schema.workHandoffPackage).where(eq(schema.workHandoffPackage.teamId, vid.id)).limit(1);
  const fill = () => ({ values: Object.fromEntries(pkg.fields.map((field) => [field.key, field.type === "url" ? "https://drive.google.com/kich-ban-v3" : "2"])), checked: pkg.checklist.map((item) => item.id) });
  const newVidTask = async (title: string, stateId: string, assignee: Key, extra: Partial<Parameters<typeof createWorkTask>[0]> = {}) => (await createWorkTask({ teamId: vid.id, projectId: tvc.id, title, stateId, assigneePersonId: id[assignee], dueDate: addDays(today, 7), ...extra }, id.tam)).task.id;
  // Pending: the lead handed the shoot plan to Huy, who has not accepted yet.
  const pending = await newVidTask("Kế hoạch quay ngày 1", vidScript, "tam");
  await handOffStage(pending, { toStateId: vidShoot, ...fill(), links: [], fileId: null, toPersonId: id.huy, note: { context: "Kịch bản v3 đã được khách duyệt.", next: "Lên shot list và call sheet ngày 1.", links: ["https://drive.google.com/kich-ban-v3"] } }, actor("tam"));
  // Returned: Linh sent it back for the missing call sheet.
  const returned = await newVidTask("Kế hoạch quay ngày 2", vidScript, "tam");
  const { handoff: toReturn } = await handOffStage(returned, { toStateId: vidShoot, ...fill(), links: [], fileId: null, toPersonId: id.linh, note: { context: "Cảnh sản phẩm trong studio.", next: "Chuẩn bị đạo cụ." } }, actor("tam"));
  if (toReturn) await returnHandoff(toReturn.id, "Chưa có call sheet và giờ thuê studio.", actor("linh"));
  // Accepted: the storyboard hand-off went through.
  const accepted = await newVidTask("Shot list cảnh sum họp", vidScript, "tam");
  const { handoff: toAccept } = await handOffStage(accepted, { toStateId: vidShoot, ...fill(), links: [], fileId: null, toPersonId: id.huy, note: { context: "Cảnh sum họp bữa cơm tất niên." } }, actor("tam"));
  if (toAccept) await acceptHandoff(toAccept.id, actor("huy"));
  // Cross-team: the teaser goes to the social team, where it waits in triage.
  await sendToTeam(accepted, { teamId: crs.id, title: "Đăng teaser TVC Tết lên fanpage Mộc An", dueDate: addDays(today, 10), note: { context: "Teaser 6 giây sẽ xong sau buổi quay.", next: "Lên lịch đăng và caption.", links: ["https://drive.google.com/teaser"] } }, actor("tam"));

  // A blocker on the offline edit, waiting on the lead.
  const offline = taskNamed("Dựng bản offline");
  if (offline) await raiseBlocker(offline, { reason: "Chờ nhạc nền được mua bản quyền", neededPersonId: id.tam }, actor("huy"));

  // The review chain: lead, then the client through the account manager — with the evidence.
  await saveReviewChain({ teamId: vid.id, projectId: null }, null, { name: "Video: trưởng nhóm → khách", contentFormat: "tvc", isActive: true, stages: [{ name: "Trưởng nhóm duyệt", reviewer: "team_lead", dueHours: 24 }, { name: "Khách duyệt", reviewer: "client", dueHours: 72 }] }, id.long);
  const animatic = await newVidTask("Animatic 30 giây", vidEdit, "huy", { contentFormat: "tvc" });
  await submitDeliverable(animatic, { kind: "link", url: "https://drive.google.com/animatic-v1", note: "Bản dựng từ storyboard" }, actor("huy"));
  await decideStage(animatic, { decision: "approved", comment: null, client: null }, actor("long"));
  const decided = await decideStage(animatic, { decision: "approved", comment: "Khách duyệt qua email", client: { channel: "email", decidedByName: "Chị Mai Phương (Mộc An)", decidedOn: addDays(today, -1), evidenceFileId: null, evidenceUrl: "https://mail.google.com/mail/u/0/#inbox/mocan-animatic" } }, actor("duc"));
  await recordDelivery(animatic, { deliverableId: decided.deliverable.id, deliveredOn: today, recipient: "Chị Mai Phương", links: ["https://drive.google.com/animatic-v1"], note: null, confirmUnapproved: false }, actor("duc"));
  // One waiting in the chain for the lead today.
  const teaser = await newVidTask("Teaser 6 giây", vidEdit, "linh", { contentFormat: "tvc" });
  await submitDeliverable(teaser, { kind: "link", url: "https://drive.google.com/teaser-v1", note: null }, actor("linh"));

  await addPresetAutomation({ teamId: vid.id, projectId: null }, "client_changes_reopen", { name: "Khách yêu cầu sửa → mở lại", text: "Khách yêu cầu chỉnh sửa, việc đã được mở lại." }, id.long);

  // ── The retainer: Fanpage Trà Lá Xanh, this month partly delivered ───────────────────────
  const tlx = clients.get("TLX")!;
  const retainerProject = await createProject({ teamId: crs.id, name: "Retainer fanpage Trà Lá Xanh 2026", description: "Nội dung fanpage và TikTok hằng tháng.", clientId: tlx.id, status: "active", visibility: "team", leadPersonId: id.chi, startDate: `${today.slice(0, 7)}-01`, dueDate: "2026-12-31" }, id.chi);
  for (const key of ["duc", "duyen", "khoi", "anh"] as const) await setProjectMember(retainerProject.id, id[key], "member");
  await updatePlanSettings(retainerProject.id, { kind: "retainer", budgetMinutes: null, budgetByRole: [], updateCadenceDays: 14, driveUrl: "https://drive.google.com/drive/folders/tla-xanh-retainer" });
  await setAccountManager(retainerProject.id, id.duc);
  await setFee(retainerProject.id, 135_000_000);
  await updateBrief(retainerProject.id, { objective: "Giữ fanpage Trà Lá Xanh đều bài, tăng tương tác 15%.", scopeIn: "8 bài Facebook, 4 video TikTok, 1 báo cáo mỗi tháng.", successCriteria: "Tương tác trung bình +15% sau 3 tháng." });
  await saveRetainer(retainerProject.id, {
    startMonth: today.slice(0, 7) as `${number}-${number}`,
    endMonth: "2026-12",
    lines: [
      { title: "Bài đăng Facebook", quantity: 8, format: "post", channel: "facebook" },
      { title: "Video TikTok", quantity: 4, format: "short_video", channel: "tiktok" },
      { title: "Báo cáo tháng", quantity: 1, format: null, channel: null },
    ],
    minutesPerMonth: 80 * 60,
    rollover: "rollover",
    isActive: true,
    feePerMonthVnd: 45_000_000,
  });
  await runRetainers(today);
  const [retainer] = await db().select().from(schema.projectRetainer).where(eq(schema.projectRetainer.projectId, retainerProject.id));
  const [period] = await db().select().from(schema.projectRetainerPeriod).where(eq(schema.projectRetainerPeriod.retainerId, retainer.id));
  const periodLines = await db().select().from(schema.projectDeliverable).where(eq(schema.projectDeliverable.retainerPeriodId, period.id));
  const line = (title: string) => periodLines.find((row) => row.title === title)!;
  const crsPublished = state(crs.id, "Đã đăng");
  const posts = (await createTasksForLine(line("Bài đăng Facebook").id, { count: 5, assigneePersonId: id.duyen, dueDate: addDays(today, 6) }, id.chi)).taskIds;
  const videos = (await createTasksForLine(line("Video TikTok").id, { count: 2, assigneePersonId: id.khoi, dueDate: addDays(today, 8) }, id.chi)).taskIds;
  const out = [...posts.slice(0, 3), videos[0]];
  for (const [index, taskId] of out.entries()) {
    const planned = at(addDays(today, -8 + index * 2), "19:00");
    const publish = await planPublish(taskId, { platform: index === 3 ? "tiktok" : "facebook", page: index === 3 ? "@tralaxanh" : "Trà Lá Xanh Fanpage", plannedAt: planned }, actor("duyen"));
    await markPublished(publish.id, { url: index === 3 ? `https://www.tiktok.com/@tralaxanh/video/74${index}000` : `https://www.facebook.com/tralaxanh/posts/10${index}000`, publishedAt: new Date(planned.getTime() + 5 * 60_000), boosted: index === 0, adAccount: index === 0 ? "TLX Ads 01" : null }, actor("duyen"));
    await updateWorkTask(taskId, { stateId: crsPublished }, id.duyen);
    if (index < 2) await recordResult(publish.id, { recordedOn: addDays(today, -1), reach: 12_000 + index * 3_500, views: 4_000 + index * 900, engagement: 640 + index * 120, clicks: 85 + index * 20 }, actor("duc"));
  }
  // One post planned, not out yet.
  await planPublish(posts[3], { platform: "facebook", page: "Trà Lá Xanh Fanpage", plannedAt: at(addDays(today, 2), "19:00") }, actor("duyen"));
  await postStatusUpdate(retainerProject.id, { health: "on_track", summary: "Tháng này đã đăng 3/8 bài Facebook và 1/4 video TikTok.", highlights: "Bài minigame đạt reach 15.500.", nextSteps: "Quay 2 video TikTok tuần sau." }, actor("duc"));
  await addPresetAutomation({ teamId: crs.id, projectId: null }, "overdue_notify_lead", { name: "Quá hạn → báo trưởng nhóm", text: "Việc đã quá hạn, cần xem lại." }, id.chi);

  // The private pitch keeps a fee too — which only its own people (with pjm:commercial) may see.
  const pitch = projectNamed("Pitch Ngân hàng Đại Việt");
  await ensurePlan(pitch.id);
  await setFee(pitch.id, 250_000_000);
  await postStatusUpdate(pitch.id, { health: "on_track", summary: "Bản đề xuất sáng tạo đang hoàn thiện.", highlights: null, nextSteps: "Thuyết trình 30/09." }, actor("long"));

  // ── Two weeks of time; one week approved, one waiting ───────────────────────────────────
  const assigned = async (personId: string) =>
    (await db().select({ id: schema.task.id }).from(schema.task).innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id)).where(and(eq(schema.task.assigneePersonId, personId), inArray(schema.task.status, ["todo", "in_progress"]), inArray(schema.workTask.teamId, [vid.id, crs.id]))).orderBy(schema.task.dueDate).limit(4)).map((row) => row.id);
  const loggers: Key[] = ["huy", "tam", "linh", "khoi", "duyen", "duc"];
  const lastWeek = addDays(monday, -7);
  const days = Array.from({ length: 14 }, (_, index) => addDays(addDays(monday, -14), index)).filter((date) => !isWeekend(date) && date < today);
  let entries = 0;
  for (const key of loggers) {
    const taskIds = await assigned(id[key]);
    if (taskIds.length === 0) continue;
    for (const [index, date] of days.entries()) {
      const first = taskIds[index % taskIds.length];
      const second = taskIds[(index + 1) % taskIds.length];
      await logTime({ personId: id[key], date, taskId: first, category: null, minutes: 240 + (index % 3) * 30, note: null, billable: null });
      await logTime({ personId: id[key], date, taskId: second, category: null, minutes: 150, note: null, billable: null });
      await logTime({ personId: id[key], date, taskId: null, category: "internal", minutes: 30, note: "Họp đầu ngày", billable: null });
      entries += 3;
    }
  }
  await submitWeek(id.huy, lastWeek, today, at(addDays(lastWeek, 4), "18:10"));
  const [huyWeek] = await db().select().from(schema.timesheetWeek).where(and(eq(schema.timesheetWeek.personId, id.huy), eq(schema.timesheetWeek.weekStart, lastWeek)));
  await decideWeek(await loadReportReader(id.long), huyWeek.id, { type: "approve" });
  await submitWeek(id.linh, lastWeek, today, at(addDays(lastWeek, 4), "18:20"));

  // ── A week of plans and end-of-day reports: one missing, one late ───────────────────────
  const reporters: Key[] = ["huy", "tam", "linh", "khoi", "duyen", "anh", "duc"];
  const reportDays = Array.from({ length: 7 }, (_, index) => addDays(today, -7 + index)).filter((date) => !isWeekend(date) && date < today);
  let reports = 0;
  for (const key of reporters) {
    const taskIds = await assigned(id[key]);
    for (const [index, date] of reportDays.entries()) {
      if (taskIds.length) await savePlan(id[key], date, taskIds.slice(0, 2).map((taskId, position) => ({ taskId, minutes: position === 0 ? 240 : 120 })), index === 0 ? "Ưu tiên việc hạn gần" : null);
      if (key === "linh" && index === reportDays.length - 2) continue; // missing
      const late = key === "khoi" && index === reportDays.length - 3;
      await submitReport(id[key], date, { blockers: key === "huy" && index === reportDays.length - 1 ? "Chờ nhạc nền được mua bản quyền" : null, notes: index % 2 ? "Đã cập nhật tiến độ trên từng việc." : null, tomorrow: taskIds.slice(0, 1), secondsToSubmit: 35 + index * 7 }, at(date, late ? "21:40" : "17:35"));
      reports++;
    }
  }

  console.log(`Seeded PJM demo: TVC through kick-off (4 lines, 3 milestones, 1 change, 1 signed acceptance), retainer ${retainer.id.slice(0, 8)} (${out.length} delivered), ${entries} time entries, ${reports} EOD reports, 3 stage hand-offs + 1 cross-team, 1 blocker, a review chain with a recorded client decision and one version waiting, entity director ${director.email}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
