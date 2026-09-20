"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { reassignTaskAction, setTaskStatusAction } from "../actions";

export type TaskItem = {
  id: string;
  title: string;
  description: string | null;
  linkUrl?: string | null;
  status: "todo" | "in_progress" | "done" | "cancelled";
  dueDate: string | null;
  assigneePersonId: string | null;
  assigneeName: string | null;
  subjectPersonId: string | null;
  subjectName: string | null;
  /** The task's own screen, for kinds that are not worked on from this list (work tasks, obligations). */
  href?: string | null;
  /** Decided on the server by the task policy; the actions check again. */
  canMove: boolean;
  canManage: boolean;
};

/** One list for "my tasks" and for a checklist on a record's page. */
export function TaskList({ tasks, today, showSubject = false, people }: { tasks: TaskItem[]; today: string; showSubject?: boolean; /** For reassigning; only passed to people who may. */ people?: { id: string; fullName: string }[] }) {
  const t = useTranslations("tasks");
  const format = useFormatter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const run = (action: (input: unknown) => Promise<{ ok: boolean; error?: string; message?: string }>, input: unknown) =>
    startTransition(async () => {
      const result = await action(input);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
    });

  return (
    <div className="flex flex-col gap-2">
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y rounded-xl border">
        {tasks.map((task) => {
          const open = task.status === "todo" || task.status === "in_progress";
          const overdue = open && task.dueDate !== null && task.dueDate < today;
          return (
            <li key={task.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className={open ? "font-medium" : "text-muted-foreground line-through"}>
                  {task.href ? (
                    <Link href={task.href} className="hover:underline">
                      {task.title}
                    </Link>
                  ) : (
                    task.title
                  )}
                </p>
                {task.description ? <p className="text-xs text-muted-foreground">{task.description}</p> : null}
                {task.linkUrl ? (
                  <p className="text-xs">
                    <a href={task.linkUrl} className="underline underline-offset-2" {...(task.linkUrl.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                      {t("guide")}
                    </a>
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {[
                    showSubject && task.subjectName ? t("about", { name: task.subjectName }) : null,
                    task.assigneeName ?? t("unassigned"),
                    task.dueDate ? t("due", { date: format.dateTime(new Date(`${task.dueDate}T00:00:00`), { dateStyle: "medium" }) }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {showSubject && task.subjectPersonId ? (
                    <>
                      {" · "}
                      <Link href={`/people/${task.subjectPersonId}`} className="underline">
                        {t("openRecord")}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              {overdue ? <Badge variant="destructive">{t("overdue")}</Badge> : null}
              <Badge variant="outline">{t(`status.${task.status}`)}</Badge>
              {task.canManage && people && open ? (
                <Select aria-label={t("reassign")} className="w-40" defaultValue={task.assigneePersonId ?? ""} disabled={pending} onChange={(event) => run(reassignTaskAction, { taskId: task.id, assigneePersonId: event.target.value })}>
                  <option value="">{t("unassigned")}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              ) : null}
              {task.canMove && task.status === "todo" ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "in_progress" })}>
                  {t("start")}
                </Button>
              ) : null}
              {task.canMove && open ? (
                <Button size="sm" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "done" })}>
                  {t("complete")}
                </Button>
              ) : null}
              {task.canMove && task.status === "done" ? (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "todo" })}>
                  {t("reopen")}
                </Button>
              ) : null}
              {task.canManage && open ? (
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "cancelled" })}>
                  {t("cancel")}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
