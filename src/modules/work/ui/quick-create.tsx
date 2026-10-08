"use client";
// The quick-create entry of the board, the calendar and the table (FR-WRK-05): a title, Enter, and
// the task is in the project — or the team's backlog — where the view was looking: in the column
// it was typed under, on the day it was given. The list view has its own, which also shows the
// task before the server answers; these views take theirs from the refreshed page.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { createTaskAction } from "../actions";

/** Where a view files its new tasks: a project of a team, or (project null) the team's own backlog. */
export type TaskScope = { teamId: string; projectId: string | null };

export function QuickCreate({
  scope,
  defaults,
  children,
  compact = false,
  className,
}: {
  scope: TaskScope;
  /** What the view already knows of the task: the column's state, the day, the filters in force. `dueDate` may also come from a field named "dueDate" among `children`. */
  defaults?: { stateId?: string; assigneePersonId?: string | null; labelIds?: string[]; dueDate?: string | null };
  /** More fields of the form, beside the title (the calendar's day). */
  children?: React.ReactNode;
  /** A board column's: no button, Enter adds. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("work.list");
  const tWork = useTranslations("work");
  const router = useRouter();
  const title = useRef<HTMLInputElement>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = title.current?.value.trim();
    if (!value) return;
    const dueDate = new FormData(event.currentTarget).get("dueDate");
    startTransition(async () => {
      const result = await createTaskAction({
        teamId: scope.teamId,
        ...(scope.projectId ? { projectId: scope.projectId } : {}),
        title: value,
        stateId: defaults?.stateId ?? "",
        assigneePersonId: defaults?.assigneePersonId ?? "",
        labelIds: defaults?.labelIds ?? [],
        dueDate: typeof dueDate === "string" && dueDate ? dueDate : (defaults?.dueDate ?? ""),
      });
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
      if (!result.ok) return;
      if (title.current) title.current.value = "";
      router.refresh();
    });
  }

  return (
    <form onSubmit={create} className={cn("flex flex-col gap-1", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Input ref={title} aria-label={t("quickCreate")} placeholder={t("quickCreate")} maxLength={200} disabled={pending} className={cn("min-w-0 flex-1", compact ? "h-9 text-sm md:h-8" : "h-9 md:h-8")} />
        {children}
        {compact ? null : (
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {t("add")}
          </Button>
        )}
      </div>
      {errorKey ? (
        <p role="alert" className="text-xs text-destructive">
          {tWork.has(`errors.${errorKey}`) ? tWork(`errors.${errorKey}`) : tWork("errors.generic")}
        </p>
      ) : null}
    </form>
  );
}
