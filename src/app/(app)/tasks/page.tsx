import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { sortInbox } from "@/modules/platform/tasks-engine/engine/inbox";
import { presentTasks } from "@/modules/platform/tasks-engine/service";
import { TaskList } from "@/modules/platform/tasks-engine/ui/task-list";
import { loadMyWork } from "@/modules/work/service";
import { CoverCheck } from "@/modules/work/ui/cover";
import { HandoffNoteView, HandoffResponder } from "@/modules/work/ui/handoff";
import { pageTitle } from "@/i18n/page-title";
import { listPersonNames } from "@/modules/platform/people/service";
import { canEditActivity, listAllFollowUpsOf, loadCrm } from "@/modules/crm/service";
import { FollowUpList } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("myWork");

// FR-WRK-06: one inbox for everything that waits for me — deliverables to review, requests to
// approve, work tasks, compliance obligations and checklist steps (ADR-10: all of the last three
// are rows of the one task table). This page is the composition root that puts the modules' lists
// side by side; each item is worked on in its own screen, checklist steps right here.
export default async function MyWorkPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  // Every list in one cached entry (work/my-work.ts); the messages beside it.
  const [t, format, tWork, mine, followUps, crm] = await Promise.all([getTranslations("tasks"), getFormatter(), getTranslations("work"), loadMyWork(user.person.id, today), listAllFollowUpsOf(user.person.id), loadCrm(user)]);
  const people = followUps.length ? await listPersonNames() : [];
  const { tasks: { open, recentlyDone }, workItems, reviews, approvals, triage, blockers, handoffs, coverPlans, handovers } = mine;
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
        <TableCard>
          <TableCardHeader title={tWork("handoff.waiting", { count: handoffs.length })} />
          <List>
            {handoffs.map((handoff) => (
              <ListItem key={handoff.id} className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={`/work/tasks/${handoff.taskId}`} className="min-w-0 flex-1 font-medium hover:underline">
                    <span className="font-mono text-xs text-muted-foreground">{handoff.key}</span> {handoff.title}
                  </Link>
                  <Badge variant="outline">{tWork(`handoff.kinds.${handoff.kind}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{[handoff.fromName, format.dateTime(handoff.createdAt, { dateStyle: "medium" })].filter(Boolean).join(" · ")}</span>
                </div>
                <HandoffNoteView note={handoff.note} />
                <HandoffResponder handoffId={handoff.id} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      {coverPlans.length > 0 ? (
        <TableCard>
          <TableCardHeader title={tWork("cover.sectionTitle", { count: coverPlans.length })} />
          <List>
            {coverPlans.map((plan) => (
              <ListItem key={plan.id} className="flex-wrap gap-x-3 gap-y-1">
                <Link href={`/work/cover/${plan.id}`} className="min-w-0 flex-1 font-medium hover:underline">
                  {plan.mine ? tWork("cover.mine", { from: day(plan.fromDate), to: day(plan.toDate) }) : tWork("cover.theirs", { name: plan.personName, from: day(plan.fromDate), to: day(plan.toDate) })}
                </Link>
                {plan.mine && plan.status === "draft" ? <Badge variant="destructive">{tWork("cover.toFill", { count: plan.items })}</Badge> : null}
                {plan.toAcknowledge ? <Badge variant="secondary">{tWork("cover.toAcknowledge", { count: plan.toAcknowledge })}</Badge> : null}
                {plan.canHandBack ? <Badge variant="secondary">{tWork("cover.toHandBack")}</Badge> : null}
                {plan.status !== "draft" ? <Badge variant="outline">{tWork(`cover.statuses.${plan.status}`)}</Badge> : null}
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      {handovers.length > 0 ? (
        <TableCard>
          <TableCardHeader title={tWork("exit.sectionTitle", { count: handovers.length })} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("columns.title")}</TableHead>
                <TableHead kind="select">{t("columns.reason")}</TableHead>
                <TableHead kind="date">{t("columns.lastDay")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {handovers.map((handover) => (
                <TableRow key={handover.id}>
                  <TableCell>
                    <Link href={`/work/handover/${handover.id}`} className="font-medium hover:underline">
                      {tWork("exit.title", { name: handover.personName })}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{tWork(`exit.reasons.${handover.reason}`)}</Badge>
                  </TableCell>
                  <TableCell>{handover.lastDay ? day(handover.lastDay) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {reviews.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("sections.reviews", { count: reviews.length })} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("columns.key")}</TableHead>
                <TableHead kind="text">{t("columns.title")}</TableHead>
                <TableHead kind="org">{t("columns.project")}</TableHead>
                <TableHead kind="select">{t("columns.stage")}</TableHead>
                <TableHead kind="person">{t("columns.submittedBy")}</TableHead>
                <TableHead kind="number">{t("columns.version")}</TableHead>
                <TableHead kind="date">{t("columns.due")}</TableHead>
                <TableHead kind="status">{t("columns.step")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.taskId}>
                  <TableCell kind="id">{review.key}</TableCell>
                  <TableCell className="max-w-80 truncate">
                    <Link href={`/work/tasks/${review.taskId}`} className="font-medium hover:underline">
                      {review.title}
                    </Link>
                  </TableCell>
                  <TableCell>{review.projectName ?? "—"}</TableCell>
                  <TableCell>{review.stageName ?? "—"}</TableCell>
                  <TableCell>{review.submittedByName ?? "—"}</TableCell>
                  <TableCell kind="number">{review.version}</TableCell>
                  <TableCell>{review.dueDate ? day(review.dueDate) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={review.isClient ? "info" : "secondary"}>{review.isClient ? t("toRecordClient") : t("toReview")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {blockers.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("sections.blockers", { count: blockers.length })} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("columns.key")}</TableHead>
                <TableHead kind="text">{t("columns.title")}</TableHead>
                <TableHead kind="person">{t("columns.raisedBy")}</TableHead>
                <TableHead kind="text">{t("columns.reason")}</TableHead>
                <TableHead kind="status">{t("columns.step")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blockers.map((blocker) => (
                <TableRow key={blocker.id}>
                  <TableCell kind="id">{blocker.key}</TableCell>
                  <TableCell className="max-w-80 truncate">
                    <Link href={`/work/tasks/${blocker.taskId}`} className="font-medium hover:underline">
                      {blocker.title}
                    </Link>
                  </TableCell>
                  <TableCell>{blocker.raisedByName ?? "—"}</TableCell>
                  <TableCell className="max-w-80 truncate text-muted-foreground" title={blocker.reason}>
                    {blocker.reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant="destructive">{t("toUnblock")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {triageTeams.map((group) => (
        <TableCard key={group.teamId}>
          <TableCardHeader
            title={`${t("sections.triage", { count: group.items.length })} · ${group.teamName}`}
            actions={
              <Link href={`/work/teams/${group.teamId}/triage`} className="text-sm underline">
                {t("openTriage")}
              </Link>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("columns.key")}</TableHead>
                <TableHead kind="text">{t("columns.title")}</TableHead>
                <TableHead kind="date">{t("columns.created")}</TableHead>
                <TableHead kind="status">{t("columns.step")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell kind="id">{item.key}</TableCell>
                  <TableCell className="max-w-80 truncate">
                    <Link href={`/work/tasks/${item.id}`} className="font-medium hover:underline">
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell>{format.dateTime(item.createdAt, { dateStyle: "medium" })}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t("toTriage")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ))}

      {approvals.length > 0 ? (
        <TableCard>
          <TableCardHeader
            title={t("sections.approvals", { count: approvals.length })}
            actions={
              <Link href="/approvals" className="text-sm underline">
                {t("openApprovals")}
              </Link>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("columns.request")}</TableHead>
                <TableHead kind="person">{t("columns.requester")}</TableHead>
                <TableHead kind="date">{t("columns.created")}</TableHead>
                <TableHead kind="status">{t("columns.step")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {approvals.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="max-w-96 truncate">
                    <Link href={request.link ?? "/approvals"} className="font-medium hover:underline">
                      {request.summary}
                    </Link>
                  </TableCell>
                  <TableCell>{request.requesterName}</TableCell>
                  <TableCell>{format.dateTime(request.createdAt, { dateStyle: "medium" })}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t("toApprove")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {work.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("sections.work", { count: work.length })} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("columns.key")}</TableHead>
                <TableHead kind="text">{t("columns.title")}</TableHead>
                <TableHead kind="org">{t("columns.project")}</TableHead>
                <TableHead kind="date">{t("columns.due")}</TableHead>
                <TableHead kind="status">{t("columns.state")}</TableHead>
                <TableHead kind="tags">{t("columns.flags")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {work.map((item) => (
                <TableRow key={item.id}>
                  <TableCell kind="id">{item.key}</TableCell>
                  <TableCell className="max-w-80 truncate">
                    <Link href={`/work/tasks/${item.id}`} className="font-medium hover:underline">
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell>{item.projectName ?? "—"}</TableCell>
                  <TableCell>{item.dueDate ? day(item.dueDate) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.stateName}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex gap-1.5">
                      {item.blocker ? <Badge variant="destructive" title={item.blocker}>{t("flagged", { reason: item.blocker.length > 40 ? `${item.blocker.slice(0, 40)}…` : item.blocker })}</Badge> : null}
                      {item.dueDate && item.dueDate < today ? <Badge variant="destructive">{t("overdue")}</Badge> : null}
                      {item.reviewStatus === "changes_requested" ? <Badge variant="destructive">{t("changesRequested")}</Badge> : null}
                      {item.priority === 1 ? <Badge variant="secondary">{t("urgent")}</Badge> : null}
                      {item.blockedBy ? <Badge variant="outline">{t("blocked", { count: item.blockedBy })}</Badge> : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {followUps.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("sections.followUps", { count: followUps.length })}</h2>
          <FollowUpList items={followUps} canEdit={(item) => canEditActivity(crm.viewer, item, null)} people={people} meId={user.person.id} today={today} />
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
