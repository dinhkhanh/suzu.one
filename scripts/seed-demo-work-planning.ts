// Phase 3 week 3 demo data, called from seed-demo.ts after seedWork: a project made from the shared
// "monthly social retainer" template, a deliverable in its third version after two revision
// rounds (waiting for the team lead), and two recurring tasks with the occurrences the daily job
// would have made. Idempotent: skipped once any recurrence exists. Rows are written the way the
// use-cases write them.
import { and, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { person, task, taskTemplate, taskTemplateItem, workActivity, workDeliverable, workProject, workProjectMember, workRecurrence, workState, workTask, workTaskPerson, workTeam } from "../src/lib/db/schema";
import { occurrencesBetween, type RecurrenceRule } from "../src/modules/work/engine/recurrence";
import { planTree } from "../src/modules/work/engine/templates";

type Db = ReturnType<typeof drizzle>;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

const RETAINER_TEMPLATE = "Retainer social hàng tháng";
const RETAINER_ROLES: Record<string, string> = { account: "duc.phan@suzu.group", strategist: "chi.duong@suzu.group", copywriter: "duyen.huynh@suzu.group", designer: "khoi.ly@suzu.group", editor: "anh.trinh@suzu.group", community: "duc.phan@suzu.group" };

export async function seedWorkPlanning(db: Db, today: string): Promise<string> {
  const [existing] = await db.select({ id: workRecurrence.id }).from(workRecurrence).limit(1);
  if (existing) return "no work planning data (recurrences already exist)";
  const people = await db.select({ id: person.id, email: person.workEmail }).from(person);
  const personId = (email: string) => people.find((row) => row.email === email)!.id;
  const teams = new Map((await db.select().from(workTeam)).map((row) => [row.key, row]));
  const [vid, crs] = [teams.get("VID"), teams.get("CRS")];
  if (!vid || !crs) return "no work planning data (demo teams missing)";

  return db.transaction(async (tx) => {
    const states = await tx.select().from(workState);
    const stateOf = (teamId: string, name: string) => states.find((state) => state.teamId === teamId && state.name === name)!;
    const nextNumber = async (teamId: string) => (await tx.select({ seq: workTeam.taskSeq }).from(workTeam).where(eq(workTeam.id, teamId)))[0].seq + 1;
    const insertTask = async (input: { team: typeof vid; projectId: string; clientId: string | null; title: string; description?: string | null; stateName: string; done?: boolean; assignee: string | null; creator: string; due: string; parentTaskId?: string | null; estimateMinutes?: number | null; templateItemId?: string | null; recurrence?: { id: string; occurrenceDate: string }; createdAt: Date }) => {
      const state = stateOf(input.team.id, input.stateName);
      const finished = input.done ? new Date(`${input.due}T09:00:00Z`) : null;
      const [row] = await tx
        .insert(task)
        .values({ kind: "work", title: input.title, description: input.description ?? null, status: input.done ? "done" : state.category === "in_progress" || state.category === "in_review" ? "in_progress" : "todo", assigneePersonId: input.assignee, requesterPersonId: input.creator, createdByPersonId: input.creator, dueDate: input.due, estimateMinutes: input.estimateMinutes ?? null, entityId: input.team.entityId, parentTaskId: input.parentTaskId ?? null, contextType: "work_project", contextId: input.projectId, templateItemId: input.templateItemId ?? null, completedAt: finished, completedByPersonId: finished ? input.assignee : null, createdAt: input.createdAt, updatedAt: finished ?? input.createdAt })
        .returning();
      const number = await nextNumber(input.team.id);
      await tx.update(workTeam).set({ taskSeq: number }).where(eq(workTeam.id, input.team.id));
      await tx.insert(workTask).values({ taskId: row.id, teamId: input.team.id, projectId: input.projectId, number, stateId: state.id, clientId: input.clientId, boardRank: number * 1000, recurrenceId: input.recurrence?.id ?? null, occurrenceDate: input.recurrence?.occurrenceDate ?? null });
      await tx.insert(workActivity).values({ taskId: row.id, actorPersonId: input.creator, type: "created", toValue: { title: input.title, state: state.name }, createdAt: input.createdAt });
      return row.id;
    };

    // 1. Next month's retainer, made from the shared template (needs `pnpm db:seed` first).
    let fromTemplate = 0;
    const [template] = await tx.select().from(taskTemplate).where(and(eq(taskTemplate.name, RETAINER_TEMPLATE), isNull(taskTemplate.ownerId))).limit(1);
    const [september] = await tx.select().from(workProject).where(and(eq(workProject.teamId, crs.id), eq(workProject.name, "Retainer social tháng 9 — Trà Lá Xanh"))).limit(1);
    if (template && september) {
      const duc = personId("duc.phan@suzu.group");
      const anchor = `${addDays(today, 15).slice(0, 7)}-01`;
      const [project] = await tx.insert(workProject).values({ teamId: crs.id, entityId: crs.entityId, name: `Retainer social tháng ${Number(anchor.slice(5, 7))} — Trà Lá Xanh`, description: `Tạo từ mẫu “${RETAINER_TEMPLATE}”.`, clientId: september.clientId, status: "active", visibility: "team", leadPersonId: duc, startDate: anchor, createdByPersonId: duc }).returning();
      const roles = Object.fromEntries(Object.entries(RETAINER_ROLES).map(([key, email]) => [key, personId(email)]));
      await tx.insert(workProjectMember).values([...new Set(Object.values(roles))].map((id) => ({ projectId: project.id, personId: id, role: id === duc ? "lead" : "member" })));
      const items = await tx.select().from(taskTemplateItem).where(eq(taskTemplateItem.templateId, template.id));
      const made = new Map<string, string>();
      for (const node of planTree(items, { mode: "start", date: anchor }, roles, isSunday)) {
        made.set(node.templateItemId, await insertTask({ team: crs, projectId: project.id, clientId: project.clientId, title: node.title, description: node.description, stateName: "Brief", assignee: node.assigneePersonId, creator: duc, due: node.dueDate, parentTaskId: node.parentItemId ? made.get(node.parentItemId) : null, estimateMinutes: node.estimateMinutes, templateItemId: node.templateItemId, createdAt: new Date(`${addDays(today, -1)}T03:00:00Z`) }));
        fromTemplate++;
      }
    }

    // 2. A deliverable in its third version: two rounds of changes, now waiting for the team lead.
    let versions = 0;
    const [edit] = await tx.select({ id: task.id, assignee: task.assigneePersonId }).from(task).where(and(eq(task.kind, "work"), eq(task.title, "Dựng bản 3 phút"))).limit(1);
    if (edit?.assignee) {
      const long = personId("long.dang@suzu.group");
      const history = [
        { version: 1, daysAgo: 6, url: "https://drive.google.com/file/d/demo-brand-cut-v1/view", note: "Bản dựng đầu tiên, chưa có đồ họa.", decision: "changes_requested", comment: "Mở đầu dài quá, vào phỏng vấn CEO trước giây thứ 20. Nhạc nền lấn tiếng ở đoạn 1:10." },
        { version: 2, daysAgo: 3, url: "https://drive.google.com/file/d/demo-brand-cut-v2/view", note: "Đã rút mở đầu còn 15 giây, hạ nhạc nền.", decision: "changes_requested", comment: "Nhịp ổn hơn. Còn thiếu tên và chức danh người được phỏng vấn; đoạn kết cần logo tập đoàn." },
        { version: 3, daysAgo: 0, url: "https://drive.google.com/file/d/demo-brand-cut-v3/view", note: "Đã thêm đồ họa tên, chức danh và logo ở đoạn kết.", decision: "pending", comment: null },
      ] as const;
      for (const row of history) {
        const submittedAt = new Date(`${addDays(today, -row.daysAgo)}T03:30:00Z`);
        const decidedAt = row.decision === "pending" ? null : new Date(`${addDays(today, -row.daysAgo + 1)}T02:00:00Z`);
        await tx.insert(workDeliverable).values({ taskId: edit.id, version: row.version, kind: "link", url: row.url, note: row.note, submittedByPersonId: edit.assignee, submittedAt, decision: row.decision, decidedByPersonId: decidedAt ? long : null, decidedAt, decisionComment: row.comment });
        await tx.insert(workActivity).values({ taskId: edit.id, actorPersonId: edit.assignee, type: "review_submitted", toValue: { version: row.version, kind: "link", name: row.url, note: row.note }, createdAt: submittedAt });
        if (decidedAt) await tx.insert(workActivity).values({ taskId: edit.id, actorPersonId: long, type: "review_changes_requested", toValue: { version: row.version, comment: row.comment, round: row.version }, createdAt: decidedAt });
        versions++;
      }
      await tx.update(workTask).set({ reviewStatus: "submitted", reviewerPersonId: long, revisionRounds: 2, stateId: stateOf(vid.id, "Duyệt nội bộ").id }).where(eq(workTask.taskId, edit.id));
      await tx.update(task).set({ status: "in_progress", updatedAt: new Date() }).where(eq(task.id, edit.id));
      await tx.insert(workTaskPerson).values({ taskId: edit.id, personId: long, role: "follower" }).onConflictDoNothing();
    }

    // 3. Two recurring tasks with what the daily job would have made so far.
    const recurring: { team: typeof vid; projectName: string; title: string; rule: RecurrenceRule; assignee: string; creator: string; startDaysAgo: number; stateName: string }[] = [
      { team: crs, projectName: "Retainer social tháng 9 — Trà Lá Xanh", title: "Báo cáo tuần gửi khách hàng", rule: { freq: "weekly", interval: 1, weekdays: [5] }, assignee: "duc.phan@suzu.group", creator: "chi.duong@suzu.group", startDaysAgo: 21, stateName: "Brief" },
      { team: vid, projectName: "TVC Tết 2027 — Sữa Mộc An", title: "Sao lưu footage và dọn ổ dựng", rule: { freq: "weekly", interval: 2, weekdays: [1] }, assignee: "huy.ho@suzu.group", creator: "long.dang@suzu.group", startDaysAgo: 28, stateName: "Brief" },
    ];
    let occurrences = 0;
    for (const seed of recurring) {
      const [project] = await tx.select().from(workProject).where(and(eq(workProject.teamId, seed.team.id), eq(workProject.name, seed.projectName))).limit(1);
      if (!project) continue;
      const startDate = addDays(today, -seed.startDaysAgo);
      const through = addDays(today, 7);
      const [recurrence] = await tx.insert(workRecurrence).values({ teamId: seed.team.id, projectId: project.id, title: seed.title, draft: { assigneePersonId: personId(seed.assignee), priority: 3 }, rule: seed.rule, startDate, leadDays: 7, generatedThrough: through, createdByPersonId: personId(seed.creator) }).returning();
      for (const date of occurrencesBetween(seed.rule, startDate, startDate, through)) {
        const past = date < today;
        await insertTask({ team: seed.team, projectId: project.id, clientId: project.clientId, title: seed.title, stateName: past ? "Đã báo cáo" : seed.stateName, done: past, assignee: personId(seed.assignee), creator: personId(seed.creator), due: date, recurrence: { id: recurrence.id, occurrenceDate: date }, createdAt: new Date(`${addDays(date, -7)}T17:05:00Z`) });
        occurrences++;
      }
    }
    return `${fromTemplate} tasks from the retainer template, ${versions} deliverable versions (two revision rounds), ${recurring.length} recurring tasks with ${occurrences} occurrences`;
  });
}
