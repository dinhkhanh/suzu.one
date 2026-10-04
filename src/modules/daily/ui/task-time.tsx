"use client";
// Time on a task, on the task's own page (FR-PJM-24, 37): the timer in one tap, a log in two — the
// same quick log and timer Today has, with the day and a note beside them. The route mounts it
// among the task's sections, as Today mounts the quick actions: the work module's screens know
// nothing of time. The totals are the ones the reader may see (task-time.ts).
import { useTranslations } from "next-intl";
import { hoursOf } from "./format";
import { QuickLog } from "./quick-actions";
import { TimerButton } from "./timer";

type Total = { minutes: number; billable: number };

export function TaskTime({ taskId, today, earliest, billable, running, mine, total }: { taskId: string; today: string; /** The earliest day the log still takes. */ earliest: string; /** The task's project is billed by default. */ billable: boolean; running: boolean; mine: Total; /** Everyone's time, where the reader may see it. */ total: Total | null }) {
  const t = useTranslations("daily.time");
  const shown = total ?? mine;
  // "Nobody has logged" is said only by a total the reader may see; otherwise the line is their own hours.
  const nobody = !!total && total.minutes === 0;
  const facts = [
    mine.minutes > 0 || !total ? t("taskMine", { value: hoursOf(mine.minutes) }) : null,
    total && total.minutes > mine.minutes ? t("taskTotal", { value: hoursOf(total.minutes) }) : null,
    shown.billable > 0 ? t("taskBillable", { value: hoursOf(shown.billable) }) : null,
  ].filter(Boolean);
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="section-label">{t("onTask")}</h2>
      <p className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">{nobody ? <span className="font-sans">{t("taskNone")}</span> : facts.join(" · ")}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <TimerButton taskId={taskId} running={running} />
        <QuickLog date={today} taskId={taskId} billable={billable} range={{ min: earliest, max: today }} />
      </div>
    </section>
  );
}
