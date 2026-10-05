"use client";
// Recently deleted (FR-WRK-03): the tasks of a project, or of a team's backlog, deleted in the last
// days, each put back with one tap — with the sub-tasks that were deleted with it. Shown to the
// people who run the project or the team; the action re-checks.
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { restoreTaskAction } from "../actions";

export type DeletedTaskView = { id: string; key: string; title: string; deletedAt: string; deletedByPersonId: string | null; deletedByName: string | null; subtasks: number };

export function DeletedTasks({ tasks, days }: { tasks: DeletedTaskView[]; /** How long a deleted task can be put back. */ days: number }) {
  const t = useTranslations("work.deleted");
  const tWork = useTranslations("work");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const restore = (taskId: string) =>
    startTransition(async () => {
      const result = await restoreTaskAction({ taskId });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (result.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("hint", { days })}</p>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{tWork("table.key")}</TableHead>
              <TableHead kind="text">{tWork("table.title")}</TableHead>
              <TableHead kind="person" className="hidden md:table-cell">
                {t("deletedBy")}
              </TableHead>
              <TableHead kind="date">{t("deletedAt")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? <TableEmpty>{t("empty", { days })}</TableEmpty> : null}
            {tasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell kind="id">{task.key}</TableCell>
                <TableCell className="max-w-72">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{task.title}</span>
                    {task.subtasks > 0 ? <span className="text-xs text-muted-foreground">{t("subtasks", { count: task.subtasks })}</span> : null}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">{task.deletedByName ? <RecordLink kind="person" id={task.deletedByPersonId}>{task.deletedByName}</RecordLink> : "—"}</TableCell>
                <TableCell kind="date">{format.dateTime(new Date(task.deletedAt), { dateStyle: "short", timeStyle: "short" })}</TableCell>
                <TableCell kind="actions">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => restore(task.id)}>
                    {t("restore")}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}
    </div>
  );
}
