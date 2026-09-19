import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listMyTasks, presentTasks } from "@/modules/platform/tasks-engine/service";
import { TaskList } from "@/modules/platform/tasks-engine/ui/task-list";

export const metadata: Metadata = { title: "My tasks" };

// One inbox for every kind of task (ADR-10). Checklist steps today; work tasks and compliance
// obligations land in the same list in Phase 3.
export default async function TasksPage() {
  const user = await requireUser();
  const t = await getTranslations("tasks");
  const { open, recentlyDone } = await listMyTasks(user.person.id);
  const today = todayInVietnam();
  // Work tasks and obligations are worked on in their own screens; checklist steps right here.
  const linkFor = (task: { id: string; kind: string }) => (task.kind === "work" ? `/work/tasks/${task.id}` : task.kind === "obligation" ? `/ops/obligations/${task.id}` : null);
  // Overdue first, then by due date as the service ordered them.
  const ordered = [...open].sort((a, b) => Number(!!b.dueDate && b.dueDate < today) - Number(!!a.dueDate && a.dueDate < today));

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("open", { count: open.length })}</h2>
        {open.length === 0 ? <p className="text-sm text-muted-foreground">{t("openEmpty")}</p> : <TaskList tasks={presentTasks(user.principal, ordered, linkFor)} today={today} showSubject />}
      </section>
      {recentlyDone.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("recentlyDone")}</h2>
          <TaskList tasks={presentTasks(user.principal, recentlyDone, linkFor)} today={today} showSubject />
        </section>
      ) : null}
    </div>
  );
}
