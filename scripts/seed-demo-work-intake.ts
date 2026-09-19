// Phase 3 week 5 demo data, called from seed-demo.ts after the other work seeds: one intake form
// per demo team with two requests each (written the way `submitIntake` writes them), and
// estimates on the open tasks that have none, so the workload view has hours to show — a few
// people end up over capacity on purpose. Idempotent: skipped once any intake form exists.
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { person, task, workActivity, workIntakeForm, workProject, workState, workTask, workTeam } from "../src/lib/db/schema";
import { describeAnswers, dueDateFrom, fieldKey, type IntakeField } from "../src/modules/work/engine/intake";

type Db = ReturnType<typeof drizzle>;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const keyed = (fields: Omit<IntakeField, "key">[]): IntakeField[] => fields.map((field, index) => ({ key: fieldKey(index), ...field }));

const FORMS = [
  {
    team: "VID",
    name: "Yêu cầu quay dựng video",
    description: "Dành cho các phòng ban cần video nội bộ hoặc cho khách hàng. Vui lòng gửi trước ít nhất 5 ngày làm việc.",
    fields: keyed([
      { label: "Mục đích và nội dung chính", type: "long_text", required: true },
      { label: "Định dạng", type: "select", required: true, options: ["Reels / TikTok (dọc)", "YouTube (ngang)", "TVC", "Recap sự kiện"] },
      { label: "Cần trước ngày", type: "date", required: true },
      { label: "Link brief hoặc tài liệu", type: "url", required: false },
    ]),
    requests: [
      { by: "duc.phan@suzu.group", title: "Clip recap workshop khách hàng Lumi", daysAgo: 3, answers: ["Recap 60 giây buổi workshop ngày 18/9 cho fanpage Lumi, cần phụ đề.", "Reels / TikTok (dọc)", 8, "https://drive.google.com/drive/folders/lumi-workshop"] },
      { by: "mai.le@suzu.group", title: "Video giới thiệu văn hóa công ty cho nhân viên mới", daysAgo: 1, answers: ["Video 2–3 phút dùng trong buổi hội nhập: lời chào của CEO, một ngày ở Suzu, các phòng ban.", "YouTube (ngang)", 25, null] },
    ],
  },
  {
    team: "CRS",
    name: "Yêu cầu thiết kế",
    description: "Banner, ấn phẩm, slide. Ghi rõ kích thước và nơi sử dụng để nhóm ước lượng thời gian.",
    fields: keyed([
      { label: "Cần thiết kế gì, dùng ở đâu", type: "long_text", required: true },
      { label: "Loại ấn phẩm", type: "select", required: true, options: ["Banner mạng xã hội", "Ấn phẩm in", "Slide thuyết trình", "Khác"] },
      { label: "Kích thước", type: "text", required: false },
      { label: "Cần trước ngày", type: "date", required: false },
    ]),
    requests: [
      { by: "bao.pham@suzu.group", title: "Poster tuyển dụng Dựng phim", daysAgo: 2, answers: ["Poster đăng fanpage và nhóm tuyển dụng cho vị trí Dựng phim (SZM), tông màu thương hiệu.", "Banner mạng xã hội", "1080x1350", 6] },
      { by: "tuan.vo@suzu.group", title: "Slide báo cáo tài chính quý 3", daysAgo: 0, answers: ["Làm lại template slide báo cáo quý cho Ban Giám đốc, khoảng 15 trang.", "Slide thuyết trình", null, 12] },
    ],
  },
] as const;

// Estimates by where the task stands: what is being worked on is bigger than what is still an idea.
const ESTIMATE_BY_CATEGORY: Record<string, number[]> = { backlog: [240, 480], todo: [480, 960, 720], in_progress: [960, 1440, 1920], in_review: [180, 240] };

export async function seedWorkIntake(db: Db, today: string): Promise<string> {
  const [existing] = await db.select({ id: workIntakeForm.id }).from(workIntakeForm).limit(1);
  if (existing) return "no intake forms (they already exist)";
  const teams = new Map((await db.select().from(workTeam)).map((row) => [row.key, row]));
  if (!teams.get("VID") || !teams.get("CRS")) return "no intake forms (demo teams missing)";
  const people = await db.select({ id: person.id, email: person.workEmail }).from(person);
  const personId = (email: string) => people.find((row) => row.email === email)?.id ?? null;

  return db.transaction(async (tx) => {
    const states = await tx.select().from(workState);
    let requests = 0;
    for (const form of FORMS) {
      const team = teams.get(form.team)!;
      const [lead] = await tx.select({ id: workProject.leadPersonId }).from(workProject).where(eq(workProject.teamId, team.id)).limit(1);
      const [row] = await tx.insert(workIntakeForm).values({ teamId: team.id, projectId: null, name: form.name, description: form.description, audience: "group", fields: [...form.fields], isActive: true, createdByPersonId: lead?.id ?? null }).returning();
      const backlog = states.filter((state) => state.teamId === team.id && state.isActive).sort((a, b) => a.sortOrder - b.sortOrder).find((state) => state.category === "backlog") ?? states.find((state) => state.teamId === team.id)!;
      for (const request of form.requests) {
        const requester = personId(request.by);
        if (!requester) continue;
        const answers: Record<string, string> = {};
        form.fields.forEach((field, index) => {
          const value = request.answers[index];
          if (value === null || value === undefined) return;
          answers[field.key] = typeof value === "number" ? addDays(today, value) : value;
        });
        const createdAt = new Date(Date.parse(`${addDays(today, -request.daysAgo)}T03:00:00Z`));
        const [created] = await tx
          .insert(task)
          .values({ kind: "work", title: request.title, description: describeAnswers(form.name, form.fields, answers), status: "todo", assigneePersonId: null, requesterPersonId: requester, createdByPersonId: requester, dueDate: dueDateFrom(form.fields, answers), entityId: team.entityId, createdAt, updatedAt: createdAt })
          .returning();
        const [{ seq }] = await tx.select({ seq: workTeam.taskSeq }).from(workTeam).where(eq(workTeam.id, team.id));
        await tx.update(workTeam).set({ taskSeq: seq + 1 }).where(eq(workTeam.id, team.id));
        await tx.insert(workTask).values({ taskId: created.id, teamId: team.id, projectId: null, number: seq + 1, stateId: backlog.id, boardRank: (seq + 1) * 1000, intakeFormId: row.id });
        await tx.insert(workActivity).values({ taskId: created.id, actorPersonId: requester, type: "created", createdAt });
        requests += 1;
      }
    }

    // Estimates where there are none: deterministic, by workflow category and position in the list.
    const open = await tx
      .select({ id: task.id, category: workState.category })
      .from(task)
      .innerJoin(workTask, eq(workTask.taskId, task.id))
      .innerJoin(workState, eq(workState.id, workTask.stateId))
      .where(and(eq(task.kind, "work"), isNull(task.deletedAt), isNull(task.estimateMinutes), isNull(task.parentTaskId), inArray(task.status, ["todo", "in_progress"]), isNull(workTask.intakeFormId)))
      .orderBy(asc(task.createdAt), asc(task.title));
    let estimated = 0;
    for (const [index, row] of open.entries()) {
      // Every sixth task stays without an estimate: the view has to show that too.
      if (index % 6 === 5) continue;
      const options = ESTIMATE_BY_CATEGORY[row.category] ?? ESTIMATE_BY_CATEGORY.todo;
      await tx.update(task).set({ estimateMinutes: options[index % options.length] }).where(eq(task.id, row.id));
      estimated += 1;
    }
    return `${FORMS.length} intake forms with ${requests} requests, estimates on ${estimated} open tasks`;
  });
}
