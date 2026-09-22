import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { listInbox } from "@/modules/platform/approvals/service";
import { requireUser } from "@/modules/platform/auth/session";
import { sortInbox } from "@/modules/platform/tasks-engine/engine/inbox";
import { listMyTasks, presentTasks } from "@/modules/platform/tasks-engine/service";
import { TaskList } from "@/modules/platform/tasks-engine/ui/task-list";
import { listMyWorkItems, listReviewsWaitingFor } from "@/modules/work/service";

export const metadata: Metadata = { title: "My work" };

// FR-WRK-06: one inbox for everything that waits for me — deliverables to review, requests to
// approve, work tasks, compliance obligations and checklist steps (ADR-10: all of the last three
// are rows of the one task table). This page is the composition root that puts the modules' lists
// side by side; each item is worked on in its own screen, checklist steps right here.
export default async function MyWorkPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  const [t, format, { open, recentlyDone }, workItems, reviews, approvals] = await Promise.all([getTranslations("tasks"), getFormatter(), listMyTasks(user.person.id), listMyWorkItems(user.person.id), listReviewsWaitingFor(user.person.id), listInbox(user.person.id)]);
  const linkFor = (task: { id: string; kind: string }) => (task.kind === "work" ? `/work/tasks/${task.id}` : task.kind === "obligation" ? `/ops/obligations/${task.id}` : null);
  const work = sortInbox(workItems, today);
  const obligations = sortInbox(open.filter((task) => task.kind === "obligation"), today);
  const checklist = sortInbox(open.filter((task) => task.kind !== "work" && task.kind !== "obligation"), today);
  const total = work.length + obligations.length + checklist.length + reviews.length + approvals.length;
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      {total === 0 ? <p className="text-sm text-muted-foreground">{t("openEmpty")}</p> : null}

      {reviews.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.reviews", { count: reviews.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {reviews.map((review) => (
              <li key={review.taskId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/work/tasks/${review.taskId}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{review.key}</span> {review.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[review.projectName, t("reviewFrom", { name: review.submittedByName ?? "—", version: review.version }), review.dueDate ? t("due", { date: day(review.dueDate) }) : null].filter(Boolean).join(" · ")}</p>
                </div>
                <Badge variant="secondary">{t("toReview")}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {approvals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.approvals", { count: approvals.length })}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {approvals.map((request) => (
              <li key={request.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1">
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
                <div className="min-w-0 flex-1">
                  <Link href={`/work/tasks/${item.id}`} className="font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{item.key}</span> {item.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{[item.projectName, item.dueDate ? t("due", { date: day(item.dueDate) }) : null, item.blockedBy ? t("blocked", { count: item.blockedBy }) : null].filter(Boolean).join(" · ")}</p>
                </div>
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
