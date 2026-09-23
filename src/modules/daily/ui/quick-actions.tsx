"use client";
// Today's quick actions (FR-PJM-37): each is a tap or two on a phone — move a task on, plan it for
// today, log time on it, add a new one. The work module's own actions do the moving and creating;
// the page hands them in, so this module never reaches into work's internals. Changing a task's
// state is work's own control (work/ui/task-state-select.tsx): it opens the hand-off sheet.
import { Check, Clock, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { addToPlanAction } from "../actions";
import { TIME_CATEGORIES } from "../enums";
import { logTimeAction } from "../time-actions";
import { parseDuration, QUICK_MINUTES } from "./format";
import { useRun } from "./use-run";

type Action = (input: unknown) => Promise<ActionResult<unknown>>;

/** One tap: the task joins today's plan. */
export function PlanTodayButton({ taskId }: { taskId: string }) {
  const t = useTranslations("daily");
  const { run, pending, errorKey } = useRun();
  return (
    <>
      <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => run(addToPlanAction, { taskId })}>
        <Plus aria-hidden /> {t("today.planIt")}
      </Button>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </>
  );
}

/**
 * Log time in two taps: open, tap a length. A task row passes its task; the free form (no task)
 * offers the day's tasks and the non-task categories, and a typed length ("1h30").
 *
 * Whether the time is billed to the client (FR-PJM-24, Q17) is part of every log: the box starts
 * from the project's own kind — which is what the server would use anyway — and following the
 * target when it changes, and the person may tick it either way before saving.
 */
export function QuickLog({ date, taskId, billable = false, tasks }: { date: string; taskId?: string; /** The task's project is billed by default (the single-task form). */ billable?: boolean; tasks?: { id: string; label: string; billable: boolean }[] }) {
  const t = useTranslations("daily");
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(taskId ? `task:${taskId}` : tasks?.[0] ? `task:${tasks[0].id}` : `category:${TIME_CATEGORIES[0]}`);
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState<number | null>(null);
  // null = whatever the target itself says; a tick or an untick is the person's own word.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const { run, pending, errorKey } = useRun();
  // Time on a category is nobody's client work; a task's follows its project.
  const byDefault = taskId ? billable : (tasks?.find((task) => `task:${task.id}` === target)?.billable ?? false);
  const billed = chosen ?? byDefault;
  const log = (minutes: number | null) => {
    if (!minutes) return;
    const [kind, id] = target.split(":");
    run(logTimeAction, { date, minutes, billable: billed ? "yes" : "no", ...(kind === "task" ? { taskId: id } : { category: id }) }, () => {
      setDone(minutes);
      setTyped("");
      setOpen(false);
    });
  };
  if (!open)
    return (
      <Button type="button" size="xs" variant="ghost" onClick={() => setOpen(true)} aria-label={t("time.log")}>
        {done ? <Check aria-hidden /> : <Clock aria-hidden />} {done ? t("time.logged", { minutes: done }) : t("time.log")}
      </Button>
    );
  return (
    <div className="flex w-full flex-col gap-2 rounded-lg border bg-muted/40 p-2">
      {taskId ? null : (
        <Select
          aria-label={t("time.what")}
          value={target}
          onChange={(event) => {
            setTarget(event.target.value);
            setChosen(null);
          }}
        >
          {(tasks ?? []).map((task) => (
            <option key={task.id} value={`task:${task.id}`}>
              {task.label}
            </option>
          ))}
          <optgroup label={t("time.otherTime")}>
            {TIME_CATEGORIES.map((category) => (
              <option key={category} value={`category:${category}`}>
                {t(`time.categories.${category}`)}
              </option>
            ))}
          </optgroup>
        </Select>
      )}
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={billed} onChange={(event) => setChosen(event.target.checked)} /> {t("time.billableLabel")}
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        {QUICK_MINUTES.map((minutes) => (
          <Button key={minutes} type="button" size="sm" variant="outline" disabled={pending} onClick={() => log(minutes)}>
            {t("time.chip", { minutes })}
          </Button>
        ))}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            log(parseDuration(typed));
          }}
        >
          <Input aria-label={t("time.typed")} placeholder={t("time.typedPlaceholder")} value={typed} onChange={(event) => setTyped(event.target.value)} className="h-8 w-20" inputMode="text" />
          <Button type="submit" size="sm" disabled={pending || !parseDuration(typed)}>
            {t("time.save")}
          </Button>
        </form>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </div>
  );
}

type Targets = { teams: { id: string; key: string; name: string; canFileInBacklog: boolean }[]; projects: { id: string; teamId: string; name: string }[] };

/** A new task of mine, due today unless said otherwise, straight into today's plan. */
export function QuickAdd({ targets, createTask, selfId, today }: { targets: Targets; createTask: Action; selfId: string; today: string }) {
  const t = useTranslations("daily");
  const router = useRouter();
  const places = [...targets.projects.map((project) => ({ value: `project:${project.id}`, label: project.name, teamId: project.teamId, projectId: project.id as string | null })), ...targets.teams.filter((team) => team.canFileInBacklog).map((team) => ({ value: `team:${team.id}`, label: t("today.backlogOf", { team: team.name }), teamId: team.id, projectId: null }))];
  const [place, setPlace] = useState(places[0]?.value ?? "");
  const [title, setTitle] = useState("");
  const [planIt, setPlanIt] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (places.length === 0) return null;
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const chosen = places.find((row) => row.value === place);
    if (!chosen || !title.trim()) return;
    startTransition(async () => {
      const result = await createTask({ teamId: chosen.teamId, ...(chosen.projectId ? { projectId: chosen.projectId } : {}), title, assigneePersonId: selfId, dueDate: today });
      if (!result.ok) return setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
      if (planIt) {
        const planned = await addToPlanAction({ taskId: (result.data as { id: string }).id });
        if (!planned.ok) setErrorKey((planned.error === "failed" ? planned.message : planned.error) ?? "generic");
      }
      setErrorKey(null);
      setTitle("");
      router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input aria-label={t("today.quickAdd")} placeholder={t("today.quickAdd")} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className="flex-1" />
        <Button type="submit" disabled={pending || !title.trim()} aria-label={t("today.add")}>
          <Plus aria-hidden />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <Select aria-label={t("today.where")} value={place} onChange={(event) => setPlace(event.target.value)} className="h-8 w-auto max-w-56 text-xs">
          {places.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={planIt} onChange={(event) => setPlanIt(event.target.checked)} /> {t("today.addToPlan")}
        </label>
      </div>
      <FormError namespace="daily.errors" errorKey={errorKey} />
    </form>
  );
}
