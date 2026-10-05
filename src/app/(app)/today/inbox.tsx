import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { IsoDate } from "@/lib/dates";
import { recordHref } from "@/lib/record-routes";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { sortInbox } from "@/modules/platform/tasks-engine/engine/inbox";
import { presentTasks } from "@/modules/platform/tasks-engine/service";
import { TaskList } from "@/modules/platform/tasks-engine/ui/task-list";
import type { MyWork } from "@/modules/work/service";
import { CoverCheck } from "@/modules/work/ui/cover";
import { HandoffNoteView, HandoffResponder } from "@/modules/work/ui/handoff";
import { DueText, dotOf, PersonAvatar, ProjectChip, StateDot, TaskKey } from "@/modules/work/ui/task-row";
import { listPersonNames } from "@/modules/platform/people/service";
import { type ActivityView, canEditActivity, loadCrm } from "@/modules/crm/service";
import { FollowUpList } from "@/modules/crm/ui/views";

export const INBOX_VIEWS = ["work", "reviews", "approvals", "handoffs"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/** How many items each inbox tab holds; the open follow-ups are counted, not listed, off the work tab. */
export function inboxCounts(mine: MyWork, followUps: number): Record<InboxView, number> {
  const { tasks: { open }, workItems, reviews, approvals, triage, blockers, handoffs, coverPlans, handovers } = mine;
  return {
    work: workItems.length + open.filter((task) => task.kind !== "work").length + followUps,
    reviews: reviews.length + blockers.length + triage.length,
    approvals: approvals.length,
    handoffs: handoffs.length + coverPlans.length + handovers.length,
  };
}

// FR-WRK-06: one inbox for everything that waits for me — deliverables to review, requests to
// approve, work tasks, compliance obligations and checklist steps (ADR-10: all of the last three
// are rows of the one task table). The Today page holds it under its tabs (`?view=`), one kind of
// waiting per tab; each item is worked on in its own screen, checklist steps right here.
export async function Inbox({ view, user, today, mine, followUps }: { view: InboxView; user: CurrentUser; today: IsoDate; mine: MyWork; /** Every open follow-up, on the work tab. */ followUps: ActivityView[] }) {
  const [t, format, tWork, crm, people] = await Promise.all([getTranslations("tasks"), getFormatter(), getTranslations("work"), loadCrm(user), followUps.length ? listPersonNames() : Promise.resolve([])]);
  const { tasks: { open, recentlyDone }, workItems, reviews, approvals, triage, blockers, handoffs, coverPlans, handovers } = mine;
  const linkFor = (task: { id: string; kind: string }) => (task.kind === "work" ? recordHref("task", task.id) : task.kind === "obligation" ? recordHref("obligation", task.id) : null);
  const work = sortInbox(workItems, today);
  const obligations = sortInbox(open.filter((task) => task.kind === "obligation"), today);
  const checklist = sortInbox(open.filter((task) => task.kind !== "work" && task.kind !== "obligation"), today);
  // New work for the teams I lead (FR-PJM-32), one link per team's queue.
  const triageTeams = [...Map.groupBy(triage, (item) => item.teamId)].map(([teamId, items]) => ({ teamId, teamName: items[0].teamName, items }));
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const shows = (section: InboxView) => view === section;

  const flags = (item: (typeof work)[number]) => (
    <>
      {item.blocker ? <Badge variant="destructive" title={item.blocker}>{t("flagged", { reason: item.blocker.length > 40 ? `${item.blocker.slice(0, 40)}…` : item.blocker })}</Badge> : null}
      {item.reviewStatus === "changes_requested" ? <Badge variant="destructive">{t("changesRequested")}</Badge> : null}
      {item.priority === 1 ? <Badge variant="warning">{t("urgent")}</Badge> : null}
      {item.blockedBy ? <Badge variant="outline">{t("blocked", { count: item.blockedBy })}</Badge> : null}
    </>
  );

  return (
    <>
      {/* Leave cover is drafted on demand where it is shown (FR-PJM-44); the night's job does it otherwise. */}
      {view === "handoffs" ? <CoverCheck /> : null}
      {inboxCounts(mine, followUps.length)[view] === 0 ? <p className="text-sm text-muted-foreground">{t("openEmpty")}</p> : null}

      {shows("handoffs") && handoffs.length > 0 ? (
        <Section title={tWork("handoff.waiting", { count: handoffs.length })}>
          <List>
            {handoffs.map((handoff) => (
              <ListItem key={handoff.id} className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Link href={recordHref("task", handoff.taskId)} className="flex min-w-0 flex-1 items-center gap-2 font-medium hover:underline">
                    <TaskKey>{handoff.key}</TaskKey>
                    <span className="truncate">{handoff.title}</span>
                  </Link>
                  <Badge variant="outline">{tWork(`handoff.kinds.${handoff.kind}`)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {handoff.fromName ? (
                      <>
                        <RecordLink kind="person" id={handoff.fromPersonId}>
                          {handoff.fromName}
                        </RecordLink>
                        {" · "}
                      </>
                    ) : null}
                    {format.dateTime(handoff.createdAt, { dateStyle: "medium" })}
                  </span>
                </div>
                <HandoffNoteView note={handoff.note} />
                <HandoffResponder handoffId={handoff.id} />
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}

      {shows("handoffs") && coverPlans.length > 0 ? (
        <Section title={tWork("cover.sectionTitle", { count: coverPlans.length })}>
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
        </Section>
      ) : null}

      {shows("handoffs") && handovers.length > 0 ? (
        <Section title={tWork("exit.sectionTitle", { count: handovers.length })}>
          <TableCard>
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
                    <TableCell kind="date">{handover.lastDay ? day(handover.lastDay) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      {shows("reviews") && reviews.length > 0 ? (
        <Section title={t("sections.reviews", { count: reviews.length })}>
          {/* On a phone: one row per deliverable, the title and a meta line. */}
          <List className="md:hidden">
            {reviews.map((review) => (
              <ListItem key={review.taskId} href={recordHref("task", review.taskId)} className="gap-3">
                <StateDot category="in_review" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <TaskKey>{review.key}</TaskKey>
                    <span className="truncate font-medium">{review.title}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {review.projectName ? <ProjectChip name={review.projectName} projectId={review.projectId} /> : null}
                    <span>{review.submittedByName ?? "—"} · v{review.version}</span>
                    <DueText dueDate={review.dueDate} today={today} open />
                  </span>
                </span>
                <Badge variant={review.isClient ? "info" : "violet"}>{review.isClient ? t("toRecordClient") : t("toReview")}</Badge>
              </ListItem>
            ))}
          </List>
          <TableCard className="hidden md:flex">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="status" className="w-px" />
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
                    <TableCell className="pr-0"><StateDot category="in_review" /></TableCell>
                    <TableCell kind="id">{review.key}</TableCell>
                    <TableCell className="max-w-80 truncate">
                      <RecordLink kind="task" id={review.taskId} className="font-medium">
                        {review.title}
                      </RecordLink>
                    </TableCell>
                    <TableCell className="max-w-56">{review.projectName ? <ProjectChip name={review.projectName} projectId={review.projectId} /> : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{review.stageName ?? "—"}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <PersonAvatar name={review.submittedByName} />
                        <RecordLink kind="person" id={review.submittedByPersonId} className="truncate">
                          {review.submittedByName ?? "—"}
                        </RecordLink>
                      </span>
                    </TableCell>
                    <TableCell kind="number">{review.version}</TableCell>
                    <TableCell kind="date"><DueText dueDate={review.dueDate} today={today} open /></TableCell>
                    <TableCell>
                      <Badge variant={review.isClient ? "info" : "violet"}>{review.isClient ? t("toRecordClient") : t("toReview")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      {shows("reviews") && blockers.length > 0 ? (
        <Section title={t("sections.blockers", { count: blockers.length })}>
          <List className="md:hidden">
            {blockers.map((blocker) => (
              <ListItem key={blocker.id} href={recordHref("task", blocker.taskId)} className="gap-3">
                <StateDot category="in_progress" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <TaskKey>{blocker.key}</TaskKey>
                    <span className="truncate font-medium">{blocker.title}</span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{blocker.raisedByName ?? "—"} · {blocker.reason}</span>
                </span>
                <Badge variant="destructive">{t("toUnblock")}</Badge>
              </ListItem>
            ))}
          </List>
          <TableCard className="hidden md:flex">
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
                      <RecordLink kind="task" id={blocker.taskId} className="font-medium">
                        {blocker.title}
                      </RecordLink>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <PersonAvatar name={blocker.raisedByName} />
                        <RecordLink kind="person" id={blocker.raisedByPersonId} className="truncate">
                          {blocker.raisedByName ?? "—"}
                        </RecordLink>
                      </span>
                    </TableCell>
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
        </Section>
      ) : null}

      {shows("reviews")
        ? triageTeams.map((group) => (
            <Section
              key={group.teamId}
              title={
                <>
                  {t("sections.triage", { count: group.items.length })} · <RecordLink kind="team" id={group.teamId}>{group.teamName}</RecordLink>
                </>
              }
              action={<Link href={`/work/teams/${group.teamId}/triage`}>{t("openTriage")}</Link>}
            >
              <TableCard>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead kind="id">{t("columns.key")}</TableHead>
                      <TableHead kind="text">{t("columns.title")}</TableHead>
                      <TableHead kind="date" className="hidden md:table-cell">{t("columns.created")}</TableHead>
                      <TableHead kind="status">{t("columns.step")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell kind="id">{item.key}</TableCell>
                        <TableCell className="max-w-80 truncate">
                          <RecordLink kind="task" id={item.id} className="font-medium">
                            {item.title}
                          </RecordLink>
                        </TableCell>
                        <TableCell kind="date" className="hidden md:table-cell">{format.dateTime(item.createdAt, { dateStyle: "medium" })}</TableCell>
                        <TableCell>
                          <Badge variant="warning">{t("toTriage")}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableCard>
            </Section>
          ))
        : null}

      {shows("approvals") && approvals.length > 0 ? (
        <Section title={t("sections.approvals", { count: approvals.length })} action={<Link href="/approvals">{t("openApprovals")}</Link>}>
          <List className="md:hidden">
            {approvals.map((request) => (
              <ListItem key={request.id} href={request.link ?? "/approvals"} className="gap-3">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{request.summary}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {request.requesterName} · {format.dateTime(request.createdAt, { dateStyle: "medium" })}
                  </span>
                </span>
                <Badge variant="warning">{t("toApprove")}</Badge>
              </ListItem>
            ))}
          </List>
          <TableCard className="hidden md:flex">
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
                    <TableCell>
                      <span className="flex items-center gap-2">
                        <PersonAvatar name={request.requesterName} />
                        <RecordLink kind="person" id={request.requesterPersonId} className="truncate">
                          {request.requesterName}
                        </RecordLink>
                      </span>
                    </TableCell>
                    <TableCell kind="date">{format.dateTime(request.createdAt, { dateStyle: "medium" })}</TableCell>
                    <TableCell>
                      <Badge variant="warning">{t("toApprove")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      {shows("work") && work.length > 0 ? (
        <Section title={t("sections.work", { count: work.length })}>
          <List className="md:hidden">
            {work.map((item) => (
              <ListItem key={item.id} href={recordHref("task", item.id)} className="gap-3">
                <StateDot category={dotOf(item.status, item.reviewStatus)} title={item.stateName} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <TaskKey>{item.key}</TaskKey>
                    <span className="truncate font-medium">{item.title}</span>
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {item.projectName ? <ProjectChip name={item.projectName} projectId={item.projectId} /> : null}
                    <span>{item.stateName}</span>
                    <DueText dueDate={item.dueDate} today={today} open />
                    {flags(item)}
                  </span>
                </span>
              </ListItem>
            ))}
          </List>
          <TableCard className="hidden md:flex">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="status" className="w-px" />
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
                    <TableCell className="pr-0"><StateDot category={dotOf(item.status, item.reviewStatus)} /></TableCell>
                    <TableCell kind="id">{item.key}</TableCell>
                    <TableCell className="max-w-80 truncate">
                      <RecordLink kind="task" id={item.id} className="font-medium">
                        {item.title}
                      </RecordLink>
                    </TableCell>
                    <TableCell className="max-w-56">{item.projectName ? <ProjectChip name={item.projectName} projectId={item.projectId} /> : <span className="text-faint">—</span>}</TableCell>
                    <TableCell kind="date"><DueText dueDate={item.dueDate} today={today} open /></TableCell>
                    <TableCell className="text-muted-foreground">{item.stateName}</TableCell>
                    <TableCell>
                      <span className="flex gap-1.5">{flags(item)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        </Section>
      ) : null}

      {shows("work") && followUps.length > 0 ? (
        <Section title={t("sections.followUps", { count: followUps.length })}>
          <FollowUpList items={followUps} canEdit={(item) => canEditActivity(crm.viewer, item, null)} people={people} meId={user.person.id} today={today} />
        </Section>
      ) : null}

      {shows("work") && obligations.length > 0 ? (
        <Section title={t("sections.obligations", { count: obligations.length })}>
          <TaskList tasks={presentTasks(user.principal, obligations, linkFor)} today={today} />
        </Section>
      ) : null}

      {shows("work") && checklist.length > 0 ? (
        <Section title={t("sections.checklist", { count: checklist.length })}>
          <TaskList tasks={presentTasks(user.principal, checklist, linkFor)} today={today} showSubject />
        </Section>
      ) : null}

      {shows("work") && recentlyDone.length > 0 ? (
        <Section title={t("recentlyDone")}>
          <TaskList tasks={presentTasks(user.principal, recentlyDone, linkFor)} today={today} showSubject />
        </Section>
      ) : null}
    </>
  );
}
