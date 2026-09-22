"use client";
// The end-of-day report (FR-PJM-22), built to be sent in under a minute: the day is already
// written from the record; the person adds blockers and notes, checks tomorrow's plan (what was not
// done today is ticked) and sends. The seconds from opening to sending are recorded.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActivityItem, DailyTaskLine } from "../schema";
import { submitReportAction } from "../actions";
import { ActivityList, TaskLines } from "./activity-list";
import { hoursOf, TEXTAREA } from "./format";
import { QuickLog } from "./quick-actions";

type Candidate = { taskId: string; key: string; title: string; dueDate: string | null; projectName: string | null };

export function ReportForm({
  date,
  draft,
  candidates,
  tomorrow,
  initial,
  submitted,
  timeRequired = false,
  notesDraft,
}: {
  date: string;
  draft: { done: DailyTaskLine[]; notDone: DailyTaskLine[]; activity: ActivityItem[]; minutesLogged: number };
  candidates: Candidate[];
  tomorrow: string[];
  initial: { blockers: string | null; notes: string | null };
  submitted: boolean;
  /** The person's team requires time logging (FR-PJM-24): a day with none logged is flagged. */
  timeRequired?: boolean;
  /**
   * The drafting button (FR-PJM-64) the page mounts beside the notes: it fills the field with id
   * "notes" and never sends. A slot, so this module does not reach into the assistant's screens.
   */
  notesDraft?: ReactNode;
}) {
  const t = useTranslations("daily");
  const router = useRouter();
  const opened = useRef<number>(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);
  const [blockers, setBlockers] = useState(initial.blockers ?? "");
  const [notes, setNotes] = useState(initial.notes ?? "");
  const [picked, setPicked] = useState<string[]>(tomorrow);
  const [showAll, setShowAll] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const notDone = new Set(draft.notDone.map((line) => line.taskId));
  const shown = showAll ? candidates : candidates.filter((task) => notDone.has(task.taskId) || picked.includes(task.taskId)).concat(candidates.filter((task) => !notDone.has(task.taskId) && !picked.includes(task.taskId)).slice(0, 5));

  const send = () =>
    startTransition(async () => {
      const secondsToSubmit = opened.current ? Math.round((Date.now() - opened.current) / 1000) : null;
      const result = await submitReportAction({ date, blockers, notes, tomorrow: picked, secondsToSubmit });
      if (!result.ok) return setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
      setErrorKey(null);
      router.push(`/daily/reports/${result.data.id}`);
    });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("report.done", { count: draft.done.length })}</h2>
        <TaskLines lines={draft.done} empty={t("report.noneDone")} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("report.notDone", { count: draft.notDone.length })}</h2>
        <TaskLines lines={draft.notDone} empty={t("report.allPlannedDone")} />
      </section>
      {timeRequired && draft.minutesLogged === 0 ? (
        <p role="status" className="rounded-xl border border-amber-600/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          {t("report.noTimeLogged")}
        </p>
      ) : null}
      <details className="rounded-xl border p-3" open={timeRequired && draft.minutesLogged === 0}>
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          {t("report.activity", { count: draft.activity.length })} · {t("hours", { value: hoursOf(draft.minutesLogged) })}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <ActivityList items={draft.activity} />
          <QuickLog date={date} tasks={candidates.map((task) => ({ id: task.taskId, label: `${task.key} ${task.title}` }))} />
        </div>
      </details>

      <section className="flex flex-col gap-2">
        <label htmlFor="blockers" className="text-sm font-medium">
          {t("report.blockers")}
        </label>
        <textarea id="blockers" value={blockers} onChange={(event) => setBlockers(event.target.value)} maxLength={2000} className={TEXTAREA} placeholder={t("report.blockersPlaceholder")} />
      </section>
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="notes" className="text-sm font-medium">
            {t("report.notes")}
          </label>
          {notesDraft}
        </div>
        <textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} className={TEXTAREA} placeholder={t("report.notesPlaceholder")} />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("report.tomorrow", { count: picked.length })}</h2>
        {candidates.length === 0 ? <p className="text-sm text-muted-foreground">{t("plan.noMoreWork")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {shown.map((task) => (
            <li key={task.taskId}>
              <label className="flex items-start gap-2 p-2.5 text-sm">
                <input type="checkbox" className="mt-1" checked={picked.includes(task.taskId)} onChange={(event) => setPicked((current) => (event.target.checked ? [...current, task.taskId] : current.filter((id) => id !== task.taskId)))} />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-xs text-muted-foreground">{task.key}</span> {task.title}
                  {task.projectName ? <span className="block text-xs text-muted-foreground">{task.projectName}</span> : null}
                </span>
                {notDone.has(task.taskId) ? <Badge variant="outline">{t("report.carried")}</Badge> : null}
              </label>
            </li>
          ))}
        </ul>
        {!showAll && shown.length < candidates.length ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll(true)} className="self-start">
            {t("report.showAll", { count: candidates.length })}
          </Button>
        ) : null}
      </section>

      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <Button type="button" size="lg" disabled={pending} onClick={send} className="flex-1 sm:flex-none">
          {submitted ? t("report.resend") : t("report.send")}
        </Button>
        <FormError namespace="daily.errors" errorKey={errorKey} />
      </div>
    </div>
  );
}
