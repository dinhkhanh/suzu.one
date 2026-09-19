// The person page's timeline: lifecycle events newest first, each with its checklist, and HR's
// forms (record an event, terminate, call a termination off, rehire). Personal tier; the service
// returns null below it. A server component, like RecordSections.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { summarize } from "@/modules/platform/tasks-engine/engine/checklist";
import { listPersonNames } from "@/modules/platform/people/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { presentTasks } from "@/modules/platform/tasks-engine/service";
import { TaskList } from "@/modules/platform/tasks-engine/ui/task-list";
import { RECORD_ONLY_EVENT_TYPES } from "../enums";
import { listLifecycleEvents } from "../lifecycle";
import { CancelEventButton, RecordEventForm, TerminateForm } from "./lifecycle-forms";

export async function LifecycleSection({ principal, personId, canManage, employed }: { principal: Principal; personId: string; canManage: boolean; /** The latest employment has no end date. */ employed: boolean }) {
  const events = await listLifecycleEvents(principal, personId);
  if (!events) return null;
  const t = await getTranslations("lifecycle");
  const tt = await getTranslations("tasks");
  const format = await getFormatter();
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const today = todayInVietnam();
  const people = canManage ? await listPersonNames() : undefined;
  const words = (placement: NonNullable<(typeof events)[number]["to"]>) => [placement.position, placement.jobLevel, placement.department, placement.team, placement.manager ? t("reportsTo", { name: placement.manager }) : null].filter(Boolean).join(" · ");
  const resignation = events.find((event) => event.type === "resignation" && event.status === "pending");

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-muted-foreground">{t("title")}</h2>
      {events.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ol className="flex flex-col gap-3">
        {events.map((event) => {
          const progress = summarize(event.tasks, today);
          const cancellable = canManage && event.status !== "cancelled" && ((event.type === "termination" && event.status === "pending") || event.type === "resignation" || (RECORD_ONLY_EVENT_TYPES as readonly string[]).includes(event.type));
          return (
            <li key={event.id} className="flex flex-col gap-2 rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="whitespace-nowrap text-muted-foreground">{day(event.effectiveDate)}</span>
                <span className={event.status === "cancelled" ? "font-medium line-through" : "font-medium"}>{t(`types.${event.type}`)}</span>
                {event.status !== "applied" ? <Badge variant="outline">{t(`status.${event.status}`)}</Badge> : null}
                {event.type === "termination" && event.reason ? <span className="text-muted-foreground">{t.has(`reasons.${event.reason}`) ? t(`reasons.${event.reason}` as "reasons.other") : event.reason}</span> : null}
                {event.approvalRequestId ? (
                  <Link href={`/approvals/resignation/${event.approvalRequestId}`} className="text-xs underline">
                    {t("openRequest")}
                  </Link>
                ) : null}
                {cancellable ? <CancelEventButton eventId={event.id} label={t("cancel")} /> : null}
              </div>
              {event.from || event.to ? (
                <p className="text-muted-foreground">
                  {event.from ? `${words(event.from)} → ` : ""}
                  {event.to ? words(event.to) : ""}
                </p>
              ) : null}
              {event.type !== "termination" && event.reason ? <p>{event.reason}</p> : null}
              {event.note ? <p className="text-muted-foreground">{event.note}</p> : null}
              {event.tasks.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {t("checklist")}: {tt("progress", { done: progress.done, total: progress.total })}
                    {progress.overdue > 0 ? ` · ${tt("progressOverdue", { count: progress.overdue })}` : ""}
                  </summary>
                  <div className="mt-2">
                    <TaskList tasks={presentTasks(principal, event.tasks)} today={today} people={people} />
                  </div>
                </details>
              ) : null}
            </li>
          );
        })}
      </ol>
      {canManage && employed ? (
        <>
          <RecordEventForm personId={personId} today={today} />
          <TerminateForm personId={personId} today={today} resignation={resignation ? { eventId: resignation.id, lastDay: resignation.effectiveDate } : undefined} />
        </>
      ) : null}
    </section>
  );
}
