import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { listInbox } from "@/modules/platform/approvals/service";
import { requireUser } from "@/modules/platform/auth/session";
import { sortInbox } from "@/modules/platform/tasks-engine/engine/inbox";
import { listMyTasks, presentTasks } from "@/modules/platform/tasks-engine/service";
import { TaskList } from "@/modules/platform/tasks-engine/ui/task-list";
import { listBlockersWaitingOn, listCoverPlansFor, listExitHandoversFor, listMyWorkItems, listPendingHandoffsFor, listReviewsWaitingFor, listTriageForLead } from "@/modules/work/service";
import { CoverCheck } from "@/modules/work/ui/cover";
import { HandoffNoteView, HandoffResponder } from "@/modules/work/ui/handoff";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myWork");

// FR-WRK-06: one inbox for everything that waits for me — deliverables to review, requests to
// approve, work tasks, compliance obligations and checklist steps (ADR-10: all of the last three
// are rows of the one task table). This page is the composition root that puts the modules' lists
// side by side; each item is worked on in its own screen, checklist steps right here.
export default async function MyWorkPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  const [t, format, { open, recentlyDone }, workItems, reviews, approvals, triage, blockers] = await Promise.all([getTranslations("tasks"), getFormatter(), listMyTasks(user.person.id), listMyWorkItems(user.person.id), listReviewsWaitingFor(user.person.id), listInbox(user.person.id), listTriageForLead(user.person.id), listBlockersWaitingOn(user.person.id)]);
  // Hand-offs waiting for me (FR-PJM-41), leave cover I fill or cover (FR-PJM-44), handovers I run (FR-PJM-45).
  const [tWork, handoffs, coverPlans, handovers] = await Promise.all([getTranslations("work"), listPendingHandoffsFor(user.person.id), listCoverPlansFor(user.person.id, today), listExitHandoversFor(user.person.id)]);
  const linkFor = (task: { id: string; kind: string }) => (task.kind === "work" ? `/work/tasks/${task.id}` : task.kind === "obligation" ? `/ops/obligations/${task.id}` : null);
  const work = sortInbox(workItems, today);
  const obligations = sortInbox(open.filter((task) => task.kind === "obligation"), today);
  const checklist = sortInbox(open.filter((task) => task.kind !== "work" && task.kind !== "obligation"), today);
  const total = work.length + obligations.length + checklist.length + reviews.length + approvals.length + triage.length + blockers.length + handoffs.length + coverPlans.length + handovers.length;
  // New work for the teams I lead (FR-PJM-32), one link per team's queue.
  const triageTeams = [...Map.groupBy(triage, (item) => item.teamId)].map(([teamId, items]) => ({ teamId, teamName: items[0].teamName, items }));
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <CoverCheck />
      {total === 0 ? <p className="text-sm text-muted-foreground">{t("openEmpty")}</p> : null}

      {handoffs.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{tWork("handoff.waiting", { count: handoffs.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {handoffs.map((handoff) => (
              <li key={handoff.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/work/tasks/${handoff.taskId}`} className="min-w-0 flex-1 font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{handoff.key}</span> {handoff.title}
                  </Link>
                  <Badge variant="outline">{tWork(`handoff.kinds.${handoff.kind}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{[handoff.fromName, format.dateTime(handoff.createdAt, { dateStyle: "medium" })].filter(Boolean).join(" · ")}</span>
                </div>
                <HandoffNoteView note={handoff.note} />
                <HandoffResponder handoffId={handoff.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {coverPlans.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{tWork("cover.sectionTitle", { count: coverPlans.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {coverPlans.map((plan) => (
              <li key={plan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <Link href={`/work/cover/${plan.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                  {plan.mine ? tWork("cover.mine", { from: day(plan.fromDate), to: day(plan.toDate) }) : tWork("cover.theirs", { name: plan.personName, from: day(plan.fromDate), to: day(plan.toDate) })}
                </Link>
                {plan.mine && plan.status === "draft" ? <Badge variant="destructive">{tWork("cover.toFill", { count: plan.items })}</Badge> : null}
                {plan.toAcknowledge ? <Badge variant="secondary">{tWork("cover.toAcknowledge", { count: plan.toAcknowledge })}</Badge> : null}
                {plan.canHandBack ? <Badge variant="secondary">{tWork("cover.toHandBack")}</Badge> : null}
                {plan.status !== "draft" ? <Badge variant="outline">{tWork(`cover.statuses.${plan.status}`)}</Badge> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {handovers.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{tWork("exit.sectionTitle", { count: handovers.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {handovers.map((handover) => (
              <li key={handover.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <Link href={`/work/handover/${handover.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                  {tWork("exit.title", { name: handover.personName })}
                </Link>
                <Badge variant="outline">{tWork(`exit.reasons.${handover.reason}`)}</Badge>
                {handover.lastDay ? <span className="text-xs text-muted-foreground">{tWork("exit.lastDay", { date: day(handover.lastDay) })}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {reviews.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.reviews", { count: reviews.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {reviews.map((review) => (
              <li key={review.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={`/work/tasks/${review.taskId}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{review.key}</span> {review.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[review.projectName, review.stageName, t("reviewFrom", { name: review.submittedByName ?? "—", version: review.version }), review.dueDate ? t("due", { date: day(review.dueDate) }) : null].filter(Boolean).join(" · ")}</p>
                </div>
                <Badge variant={review.isClient ? "info" : "secondary"}>{review.isClient ? t("toRecordClient") : t("toReview")}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {blockers.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.blockers", { count: blockers.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {blockers.map((blocker) => (
              <li key={blocker.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={`/work/tasks/${blocker.taskId}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{blocker.key}</span> {blocker.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{t("blockerFrom", { name: blocker.raisedByName ?? "—", reason: blocker.reason })}</p>
                </div>
                <Badge variant="destructive">{t("toUnblock")}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {triageTeams.map((group) => (
        <section key={group.teamId} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {t("sections.triage", { count: group.items.length })} · {group.teamName}
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {group.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={`/work/tasks/${item.id}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{item.key}</span> {item.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{format.dateTime(item.createdAt, { dateStyle: "medium" })}</p>
                </div>
                <Badge variant="secondary">{t("toTriage")}</Badge>
              </li>
            ))}
          </ul>
          <Link href={`/work/teams/${group.teamId}/triage`} className="text-sm underline">
            {t("openTriage")}
          </Link>
        </section>
      ))}

      {approvals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.approvals", { count: approvals.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {approvals.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={request.link ?? "/approvals"} className="font-medium hover:underline">
                    {request.summary}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[request.requesterName, format.dateTime(request.createdAt, { dateStyle: "medium" })].join(" · ")}</p>
                </div>
                <Badge variant="secondary">{t("toApprove")}</Badge>
              </li>
            ))}
          </ul>
          <Link href="/approvals" className="text-sm underline">
            {t("openApprovals")}
          </Link>
        </section>
      ) : null}

      {work.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.work", { count: work.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {work.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1 basis-56">
                  <Link href={`/work/tasks/${item.id}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{item.key}</span> {item.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[item.projectName, item.dueDate ? t("due", { date: day(item.dueDate) }) : null, item.blockedBy ? t("blocked", { count: item.blockedBy }) : null].filter(Boolean).join(" · ")}</p>
                </div>
                {item.blocker ? <Badge variant="destructive" title={item.blocker}>{t("flagged", { reason: item.blocker.length > 40 ? `${item.blocker.slice(0, 40)}…` : item.blocker })}</Badge> : null}
                {item.dueDate && item.dueDate < today ? <Badge variant="destructive">{t("overdue")}</Badge> : null}
                {item.reviewStatus === "changes_requested" ? <Badge variant="destructive">{t("changesRequested")}</Badge> : null}
                {item.priority === 1 ? <Badge variant="secondary">{t("urgent")}</Badge> : null}
                <Badge variant="outline">{item.stateName}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {obligations.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.obligations", { count: obligations.length })}</h2>
          <TaskList tasks={presentTasks(user.principal, obligations, linkFor)} today={today} />
        </section>
      ) : null}

      {checklist.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.checklist", { count: checklist.length })}</h2>
          <TaskList tasks={presentTasks(user.principal, checklist, linkFor)} today={today} showSubject />
        </section>
      ) : null}

      {recentlyDone.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("recentlyDone")}</h2>
          <TaskList tasks={presentTasks(user.principal, recentlyDone, linkFor)} today={today} showSubject />
        </section>
      ) : null}
    </div>
  );
}
