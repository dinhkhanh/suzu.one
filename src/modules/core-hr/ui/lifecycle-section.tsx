// The person page's timeline: lifecycle events newest first, each with its checklist, and HR's
// forms (record an event, terminate, call a termination off, rehire). Personal tier; the service
// returns null below it. A server component, like RecordSections.
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { jobTitle } from "@/lib/job-levels";
import { summarize } from "@/modules/platform/tasks-engine/engine/checklist";
import { listPersonNames } from "@/modules/platform/people/service";
import { canReadTier, type Principal } from "@/modules/platform/rbac/policy";
import { canGenerate, listTemplates } from "@/modules/documents/service";
import { presentTasks } from "@/modules/platform/tasks-engine/service";
import { TaskList } from "@/modules/platform/tasks-engine/ui/task-list";
import { RECORD_ONLY_EVENT_TYPES } from "../enums";
import { listLifecycleEvents } from "../lifecycle";
import { getPersonTarget, listEmploymentFacts } from "../service";
import { CancelEventButton, ContractEventForm, RecordEventForm, TerminateForm } from "./lifecycle-forms";

export async function LifecycleSection({ principal, personId, canManage, employed }: { principal: Principal; personId: string; canManage: boolean; /** The latest employment has no end date. */ employed: boolean }) {
  const events = await listLifecycleEvents(principal, personId);
  if (!events) return null;
  const t = await getTranslations("lifecycle");
  const tt = await getTranslations("tasks");
  const tp = await getTranslations("people");
  const format = await getFormatter();
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const today = todayInVietnam();
  const people = canManage ? await listPersonNames() : undefined;
  const words = (placement: NonNullable<(typeof events)[number]["to"]>) =>
    [placement.entity, placement.position, jobTitle(tp, placement) ?? placement.jobLevel, placement.department, placement.team, placement.manager ? t("reportsTo", { name: placement.manager }) : null].filter(Boolean).join(" · ");
  const resignation = events.find((event) => event.type === "resignation" && event.status === "pending");
  // A probation pass or a renewal comes with its contract and, when a template is chosen, its decision
  // paper: the templates offered are the decisions and contracts this viewer may issue for this person.
  const contractEvent = canManage && employed ? await contractEventOptions(principal, personId) : null;

  return (
    <section className="flex flex-col gap-3">
      <TableCard>
        <TableCardHeader title={t("title")} count={events.length || null} />
        <List>
          {events.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
          {events.map((event) => {
            const progress = summarize(event.tasks, today);
            const cancellable =
              canManage &&
              event.status !== "cancelled" &&
              !event.hasEffects &&
              ((event.type === "termination" && event.status === "pending") || event.type === "resignation" || (RECORD_ONLY_EVENT_TYPES as readonly string[]).includes(event.type));
            return (
              <ListItem key={event.id} className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap text-muted-foreground">{day(event.effectiveDate)}</span>
                  <span className={event.status === "cancelled" ? "font-medium line-through" : "font-medium"}>{t(`types.${event.type}`)}</span>
                  {/* A transfer dated ahead is recorded as applied; the date says it has not happened yet. */}
                  {event.status !== "applied" || event.effectiveDate > today ? <Badge variant="outline">{t(`status.${event.status === "applied" ? "pending" : event.status}`)}</Badge> : null}
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
                {event.contractNumber ? <p className="text-muted-foreground">{t("contractEvent.contract", { number: event.contractNumber })}</p> : null}
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
              </ListItem>
            );
          })}
        </List>
        {canManage && employed ? <RecordEventForm personId={personId} today={today} /> : null}
        {contractEvent ? <ContractEventForm personId={personId} today={today} {...contractEvent} /> : null}
      </TableCard>
      {canManage && employed ? <TerminateForm personId={personId} today={today} resignation={resignation ? { eventId: resignation.id, lastDay: resignation.effectiveDate } : undefined} /> : null}
    </section>
  );
}

async function contractEventOptions(principal: Principal, personId: string) {
  const [target, templates, [facts]] = await Promise.all([getPersonTarget(personId), listTemplates(), listEmploymentFacts({ personIds: [personId] })]);
  if (!target) return null;
  return {
    templates: templates
      .filter((template) => template.isActive && (template.kind === "decision" || template.kind === "contract") && (!template.entityId || template.entityId === target.entityId) && canGenerate(principal, target, template.tier))
      .map((template) => ({ id: template.id, name: template.name })),
    canWritePay: canReadTier(principal, target, "compensation"),
    onProbation: facts?.workforceType === "probation",
  };
}
