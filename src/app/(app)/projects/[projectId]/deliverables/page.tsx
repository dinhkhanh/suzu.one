import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listStructure, listTaskLinks, loadRegisters, openProject, REGISTER_STATUSES } from "@/modules/projects/service";
import { CancelLineButton, DeliverableForm, LineTasksForm, UnlinkButton } from "@/modules/projects/ui/plan-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { listAssignable } from "@/modules/work/service";

export const metadata: Metadata = { title: "Deliverables" };

const statusVariant = (status: string) => (status === "accepted" || status === "delivered" || status === "published" ? "success" : status === "client_review" ? "info" : status === "in_production" ? "warning" : status === "cancelled" ? "outline" : "secondary");

/**
 * The deliverables register (FR-PJM-05): what the client was promised, line by line, and how far
 * each promise has come — computed from the linked tasks, one task per unit. Progress = accepted ÷
 * promised. The lead makes the tasks of a line in one go.
 */
export default async function ProjectDeliverablesPage({ params }: PageProps<"/projects/[projectId]/deliverables">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, team, can } = context;
  const [t, tWork, format, registers, structure, links, people] = await Promise.all([getTranslations("projects"), getTranslations("work"), getFormatter(), loadRegisters([project.id]), listStructure(project.id), listTaskLinks(project.id), can.editPlan ? listAssignable(team.id, project.id) : Promise.resolve([])]);
  const register = registers.get(project.id)!;
  const milestoneName = new Map(structure.milestones.map((milestone) => [milestone.id, milestone.name]));
  const tasksOf = Map.groupBy(links.filter((link) => link.deliverableId), (link) => link.deliverableId!);
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : null);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="deliverables" />

      <section className="flex flex-col gap-2 rounded-xl border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-medium">{t("register.title")}</h2>
          <span className="text-sm">{register.promised ? t("register.progress", { accepted: register.accepted, promised: register.promised, percent: register.percent ?? 0 }) : t("register.empty")}</span>
        </div>
        {register.promised ? (
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={register.percent ?? 0} aria-label={t("register.title")}>
            <div className="h-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${Math.min(100, register.percent ?? 0)}%` }} />
          </div>
        ) : null}
      </section>

      <ol className="flex flex-col gap-3">
        {register.lines.map((line) => {
          const own = tasksOf.get(line.id) ?? [];
          const missing = Math.max(0, line.quantity - line.linked);
          return (
            <li key={line.id} className={`flex flex-col gap-2 rounded-xl border p-3 ${line.status === "cancelled" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`font-medium ${line.status === "cancelled" ? "line-through" : ""}`}>
                  {line.quantity} × {line.title}
                </span>
                <Badge variant={statusVariant(line.status)}>{t(`register.status.${line.status}`)}</Badge>
                {line.format ? <Badge variant="outline">{tWork(`formats.${line.format as "post"}`)}</Badge> : null}
                {line.channel ? <Badge variant="outline">{tWork(`channels.${line.channel as "facebook"}`)}</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {[line.milestoneId ? milestoneName.get(line.milestoneId) : null, date(line.dueDate), line.status === "cancelled" ? null : t("register.lineProgress", { accepted: line.accepted, promised: line.promised, linked: line.linked })].filter(Boolean).join(" · ")}
              </p>
              {line.status !== "cancelled" ? (
                <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {REGISTER_STATUSES.filter((status) => line.counts[status] > 0).map((status) => (
                    <span key={status}>
                      {t(`register.status.${status}`)}: {line.counts[status]}
                    </span>
                  ))}
                </p>
              ) : null}
              {own.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {own.map((task) => (
                    <li key={task.taskId} className="flex flex-wrap items-center gap-2">
                      <Link href={`/work/tasks/${task.taskId}`} className="hover:underline">
                        <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                      </Link>
                      {task.assigneeName ? <span className="text-xs text-muted-foreground">{task.assigneeName}</span> : null}
                      {can.editPlan ? <UnlinkButton taskId={task.taskId} /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {can.editPlan ? (
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">{t("register.manage")}</summary>
                  <div className="flex flex-col gap-4 pt-2">
                    {line.status !== "cancelled" ? <LineTasksForm deliverableId={line.id} missing={missing} people={people} /> : null}
                    <DeliverableForm projectId={project.id} line={{ id: line.id, title: line.title, quantity: line.quantity, format: line.format, channel: line.channel, dueDate: line.dueDate, milestoneId: line.milestoneId, sortOrder: line.sortOrder }} milestones={structure.milestones.map(({ id, name }) => ({ id, name }))} />
                    <div>
                      <CancelLineButton deliverableId={line.id} cancelled={line.status === "cancelled"} />
                    </div>
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>

      {can.editPlan ? (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
          <h2 className="text-sm font-medium">{t("register.newLine")}</h2>
          <DeliverableForm projectId={project.id} milestones={structure.milestones.map(({ id, name }) => ({ id, name }))} />
        </section>
      ) : null}
    </div>
  );
}
