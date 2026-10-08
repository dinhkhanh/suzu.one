"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { DueText, PersonAvatar, StateDot } from "./task-row";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
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
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const run = (action: (input: unknown) => Promise<{ ok: boolean; error?: string; message?: string }>, input: unknown) =>
    startTransition(async () => {
      const result = await action(input);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
    });

  const statusDot = (status: TaskItem["status"]) => (status === "in_progress" ? "in_progress" : status === "done" ? "done" : status === "cancelled" ? "cancelled" : "todo");
  const actions = (task: TaskItem, open: boolean) =>
    task.canMove || task.canManage ? (
      <span className="flex items-center justify-end gap-1.5">
        {task.canMove && task.status === "todo" ? (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "in_progress" })}>
            {t("start")}
          </Button>
        ) : null}
        {task.canMove && open ? (
          <Button size="xs" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "done" })}>
            {t("complete")}
          </Button>
        ) : null}
        {task.canMove && task.status === "done" ? (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "todo" })}>
            {t("reopen")}
          </Button>
        ) : null}
        {task.canManage && open ? (
          <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(setTaskStatusAction, { taskId: task.id, status: "cancelled" })}>
            {t("cancel")}
          </Button>
        ) : null}
      </span>
    ) : null;

  return (
    <div className="flex flex-col gap-2">
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}`) : t("errors.generic")}
        </p>
      ) : null}
      {/* On a phone: one row per task, the actions under the title. */}
      <List className="md:hidden">
        {tasks.map((task) => {
          const open = task.status === "todo" || task.status === "in_progress";
          return (
            <ListItem key={task.id} className="items-start gap-3 py-3">
              <StateDot category={statusDot(task.status)} className="mt-1.5" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={open ? "font-medium" : "text-muted-foreground line-through"}>
                  {task.href ? (
                    <Link href={task.href} className="hover:underline">
                      {task.title}
                    </Link>
                  ) : (
                    task.title
                  )}
                </span>
                {task.description?.trim() ? <span className="line-clamp-2 text-xs text-muted-foreground">{noteToPlainText(task.description)}</span> : null}
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {showSubject && task.subjectName ? (
                    <RecordLink kind="person" id={task.subjectPersonId}>
                      {task.subjectName}
                    </RecordLink>
                  ) : null}
                  <RecordLink kind="person" id={task.assigneeName ? task.assigneePersonId : null}>
                    {task.assigneeName ?? t("unassigned")}
                  </RecordLink>
                  <DueText dueDate={task.dueDate} today={today} open={open} />
                  {task.linkUrl ? (
                    <a href={task.linkUrl} className="text-link underline underline-offset-2" {...(task.linkUrl.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                      {t("guide")}
                    </a>
                  ) : null}
                </span>
                {actions(task, open) ? <span className="flex justify-start pt-1 [&>span]:justify-start">{actions(task, open)}</span> : null}
              </span>
            </ListItem>
          );
        })}
      </List>
      <TableCard className="hidden md:flex">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="status" className="w-px" />
              <TableHead kind="text">{t("columns.task")}</TableHead>
              {showSubject ? <TableHead kind="person">{t("columns.about")}</TableHead> : null}
              <TableHead kind="person">{t("columns.assignee")}</TableHead>
              <TableHead kind="date">{t("columns.due")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const open = task.status === "todo" || task.status === "in_progress";
              return (
                <TableRow key={task.id}>
                  <TableCell className="w-px pr-0">
                    <StateDot category={statusDot(task.status)} title={t(`status.${task.status}`)} />
                  </TableCell>
                  <TableCell className="min-w-56 max-w-md whitespace-normal">
                    <p className={open ? "font-medium" : "text-muted-foreground line-through"}>
                      {task.href ? (
                        <Link href={task.href} className="hover:underline">
                          {task.title}
                        </Link>
                      ) : (
                        task.title
                      )}
                    </p>
                    {task.description?.trim() ? <p className="line-clamp-2 text-xs text-muted-foreground">{noteToPlainText(task.description)}</p> : null}
                    {task.linkUrl ? (
                      <p className="text-xs">
                        <a href={task.linkUrl} className="text-link underline underline-offset-2" {...(task.linkUrl.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>
                          {t("guide")}
                        </a>
                      </p>
                    ) : null}
                  </TableCell>
                  {showSubject ? (
                    <TableCell>
                      <RecordLink kind="person" id={task.subjectPersonId}>
                        {task.subjectName ?? "—"}
                      </RecordLink>
                      {task.subjectPersonId ? (
                        <p className="text-xs">
                          <RecordLink kind="person" id={task.subjectPersonId} className="text-link underline underline-offset-2">
                            {t("openRecord")}
                          </RecordLink>
                        </p>
                      ) : null}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    {task.canManage && people && open ? (
                      <Select
                        aria-label={t("reassign")}
                        className="h-8 w-40 md:h-7 text-xs md:text-xs"
                        defaultValue={task.assigneePersonId ?? ""}
                        disabled={pending}
                        onChange={(event) => run(reassignTaskAction, { taskId: task.id, assigneePersonId: event.target.value })}
                      >
                        <option value="">{t("unassigned")}</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.fullName}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="flex items-center gap-2">
                        <PersonAvatar name={task.assigneeName} />
                        <RecordLink kind="person" id={task.assigneeName ? task.assigneePersonId : null} className={task.assigneeName ? "truncate" : "text-muted-foreground"}>
                          {task.assigneeName ?? t("unassigned")}
                        </RecordLink>
                      </span>
                    )}
                  </TableCell>
                  <TableCell kind="date">
                    <DueText dueDate={task.dueDate} today={today} open={open} long />
                  </TableCell>
                  <TableCell kind="actions">{actions(task, open)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
