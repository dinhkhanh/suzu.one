"use client";
// The end-of-day report (FR-PJM-22), built to be sent in under a minute: the day is already
// written from the record; the person adds blockers and notes, checks tomorrow's plan (what was not
// done today is ticked) and sends. The seconds from opening to sending are recorded.
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Section } from "@/components/ui/page";
import { NoteEditor } from "@/modules/platform/rich-text/ui/note-editor";
import type { ActivityItem, DailyTaskLine } from "../schema";
import { submitReportAction } from "../actions";
import { ActivityList, TaskLines } from "./activity-list";
import { hoursOf } from "./format";
import { QuickLog } from "./quick-actions";

type Candidate = { taskId: string; key: string; title: string; dueDate: string | null; projectName: string | null; /** Its project's time is billed to the client by default (FR-PJM-24). */ billable: boolean };

export function ReportForm({
  date,
  past = false,
  draft,
  candidates,
  tomorrow,
  initial,
  submitted,
  timeRequired = false,
  notesDraft,
}: {
  date: string;
  /** The report is for a day before today: the form says "that day" and "the next working day", not "today" and "tomorrow". */
  past?: boolean;
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
    <div className="flex flex-col gap-6 md:gap-8">
      <Section title={t("report.done", { count: draft.done.length })}>
        <TaskLines lines={draft.done} empty={t(past ? "report.noneDonePast" : "report.noneDone")} />
      </Section>
      <Section title={t("report.notDone", { count: draft.notDone.length })}>
        <TaskLines lines={draft.notDone} empty={t("report.allPlannedDone")} />
      </Section>
      {timeRequired && draft.minutesLogged === 0 ? <Alert variant="warning">{t(past ? "report.noTimeLoggedPast" : "report.noTimeLogged")}</Alert> : null}
      <details className="group/activity rounded-[14px] border border-border bg-background" open={timeRequired && draft.minutesLogged === 0}>
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium select-none [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            {t(past ? "report.activityPast" : "report.activity", { count: draft.activity.length })} <span className="font-mono text-xs font-normal text-muted-foreground tabular-nums">· {t("hours", { value: hoursOf(draft.minutesLogged) })}</span>
          </span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-faint transition-transform duration-200 ease-(--ease-settle) group-open/activity:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 border-t px-4 py-3">
          <ActivityList items={draft.activity} past={past} />
          <QuickLog date={date} tasks={candidates.map((task) => ({ id: task.taskId, label: `${task.key} ${task.title}`, billable: task.billable }))} />
        </div>
      </details>

      <Section title={<label htmlFor="blockers">{t("report.blockers")}</label>}>
        <NoteEditor id="blockers" draft={`daily-report:${date}:blockers`} value={blockers} onChange={setBlockers} maxLength={2000} placeholder={t("report.blockersPlaceholder")} />
      </Section>
      <Section title={<label htmlFor="notes">{t("report.notes")}</label>} action={notesDraft}>
        <NoteEditor id="notes" draft={`daily-report:${date}:notes`} value={notes} onChange={setNotes} maxLength={2000} placeholder={t("report.notesPlaceholder")} />
      </Section>

      <Section title={t(past ? "report.tomorrowPast" : "report.tomorrow", { count: picked.length })}>
        <List>
          {candidates.length === 0 ? <ListEmpty>{t("plan.noMoreWork")}</ListEmpty> : null}
          {shown.map((task, index) => (
            <ListItem key={task.taskId} className="rise p-0 md:p-0" style={{ "--i": index } as CSSProperties}>
              <label className="flex min-h-[3.25rem] flex-1 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-canvas md:min-h-12 md:px-3.5">
                <Checkbox checked={picked.includes(task.taskId)} onCheckedChange={(checked) => setPicked((current) => (checked ? [...current, task.taskId] : current.filter((id) => id !== task.taskId)))} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    <span className="font-mono text-xs font-normal text-muted-foreground">{task.key}</span> {task.title}
                  </span>
                  {task.projectName ? <span className="block truncate text-xs text-muted-foreground">{task.projectName}</span> : null}
                </span>
                {notDone.has(task.taskId) ? <Badge variant="outline">{t("report.carried")}</Badge> : null}
              </label>
            </ListItem>
          ))}
        </List>
        {!showAll && shown.length < candidates.length ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll(true)} className="self-start">
            {t("report.showAll", { count: candidates.length })}
          </Button>
        ) : null}
      </Section>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
        <Button type="button" size="lg" variant="accent" disabled={pending} onClick={send} className="w-full md:w-auto">
          {submitted ? t("report.resend") : t("report.send")}
        </Button>
        <FormError namespace="daily.errors" errorKey={errorKey} />
      </div>
    </div>
  );
}
