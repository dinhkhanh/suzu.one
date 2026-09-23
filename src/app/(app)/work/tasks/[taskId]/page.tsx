import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { acceptAttributeFor } from "@/modules/platform/files/rules";
import { canDecideReview, canDeleteTask, canEditTask, canModerateTask, canRaiseBlocker, canResolveBlocker, canSubmitDeliverable, listDeliverables, followersOf, followStateOf, getTaskDetail, listActivity, listComments, listCustomFields, listMentionable, listMoveTargets, listTaskBlockers, listTaskFiles, listAssignable, listClients, listLabels, listLinkableTasks, listProjectOptions, listStates, loadViewer, resolveTaskKey, toFieldViews } from "@/modules/work/service";
import { TaskCustomFields } from "@/modules/work/ui/custom-fields";
import { BlockerPanel, MovePanel, TriageBanner } from "@/modules/work/ui/task-foundation";
import { TaskDetailView } from "@/modules/work/ui/task-detail";
import { FollowButton, TaskDiscussion, TaskFiles } from "@/modules/work/ui/task-discussion";
import { TaskReview } from "@/modules/work/ui/task-review";
import { canRespondToHandoff, canSendToTeam, listOpenCycles, listTaskHandoffs, listTeamCycles, listTeams, TASK_FILE_OWNER, teamFacts } from "@/modules/work/service";
import { HandoffPanel } from "@/modules/work/ui/handoff";
import { todayInVietnam } from "@/lib/dates";
import { canDecideStage, canManagePublish, canManagePreviewLinks, canPinFeedback, canRecordClientDecision, canRecordDelivery, canResolvePin, canRevokePreviewLink, clientOfTask, listDeliveriesByTask, listPreviewLinks, listPublishesByTask, listTaskPins } from "@/modules/work/service";
import { DeliveryPanel } from "@/modules/work/ui/delivery";
import { PreviewLinkPanel } from "@/modules/work/ui/preview-links";
import { PublishPanel } from "@/modules/work/ui/publish";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: PageProps<"/work/tasks/[taskId]">) {
  const user = await requireUser();
  const { taskId } = await params;
  // "VID-123" in a link or a chat opens the task — also a number it had before it moved team (FR-PJM-34).
  if (/^[a-z][a-z0-9]{1,7}-\d{1,7}$/i.test(taskId)) {
    const resolved = await resolveTaskKey(taskId);
    if (resolved) redirect(`/work/tasks/${resolved}`);
    notFound();
  }
  const viewer = await loadViewer(user);
  // Not found and not allowed look the same from outside.
  const detail = /^[0-9a-f-]{36}$/.test(taskId) ? await getTaskDetail(taskId, viewer) : undefined;
  if (!detail) notFound();
  const { task, work, team, project } = detail;
  const t = await getTranslations("work");
  const canEdit = canEditTask(viewer, detail.facts);

  const moderate = canModerateTask(viewer, detail.facts);
  const [handoffs, allTeams, openCycles, teamCycles] = await Promise.all([listTaskHandoffs(task.id, viewer), canEdit ? listTeams() : [], listOpenCycles([team.id]), work.cycleId ? listTeamCycles(team.id) : []]);
  const [states, labels, clients, assignable, projects, siblings, activity, comments, files, mentionable, deliverables, fields, blockers, moveTargets] = await Promise.all([
    listStates([team.id]),
    listLabels([team.id]),
    listClients({ activeOnly: true }),
    listAssignable(team.id, work.projectId),
    canEdit ? listProjectOptions(viewer, team.id) : [],
    canEdit ? listLinkableTasks({ projectId: work.projectId, teamId: team.id }) : [],
    listActivity(task.id),
    listComments(task.id),
    listTaskFiles(task.id),
    listMentionable(detail),
    listDeliverables(task.id),
    listCustomFields({ teamId: team.id, projectId: work.projectId }),
    listTaskBlockers(task.id),
    canEdit ? listMoveTargets(viewer, detail.facts) : [],
  ]);
  const [pins, deliveries, publishes, client] = await Promise.all([listTaskPins(task.id), listDeliveriesByTask([task.id]), listPublishesByTask([task.id]), clientOfTask(detail)]);
  // The client's review links (FR-PJM-51a) are a capability handed outside the company, so the list
  // is read only for the people who may act for the client — never as directory information.
  const managesPreview = canManagePreviewLinks(viewer, detail.facts, client);
  const previewLinks = managesPreview || canRevokePreviewLink(viewer, detail.facts, client) ? await listPreviewLinks(task.id) : [];
  const today = todayInVietnam();
  // Review chains (FR-PJM-50): the waiting version's stage decides who may decide it.
  const waiting = deliverables.find((item) => item.decision === "pending");
  const stageIsClient = !!waiting?.chainId && waiting.clientStageIndex !== null && Math.min(waiting.stageIndex, waiting.stages.length - 1) === waiting.clientStageIndex;
  const canDecide = waiting?.chainId && waiting.stages.length > 0 ? canDecideStage(viewer, detail.facts, { isClient: stageIsClient, reviewerPersonId: waiting.stageReviewerPersonId, submittedByPersonId: waiting.submittedByPersonId }, client) : canDecideReview(viewer, detail.facts, { reviewerPersonId: work.reviewerPersonId, submittedByPersonId: waiting?.submittedByPersonId ?? null });
  const openBlocker = blockers.find((blocker) => !blocker.resolvedAt);
  const inTriage = work.triageStatus === "pending" || work.triageStatus === "snoozed";
  const linkedIds = new Set([task.id, ...detail.linked.map((link) => link.id)]);
  // Work goes to other teams through their triage (FR-PJM-42); the task's own closed cycle stays in the picker.
  const sendTeams = allTeams.filter((row) => row.isActive && canSendToTeam(viewer, detail.facts, teamFacts(row))).map(({ id, name }) => ({ id, name }));
  const closedCycle = teamCycles.find((cycle) => cycle.id === work.cycleId && cycle.closedAt);
  const cycleLabel = (cycle: { number: number; startDate: string; endDate: string }) => t("cycles.label", { number: cycle.number, from: cycle.startDate.split("-").reverse().slice(0, 2).join("/"), to: cycle.endDate.split("-").reverse().slice(0, 2).join("/") });
  const cycles = [...(closedCycle ? [closedCycle] : []), ...openCycles].map((cycle) => ({ id: cycle.id, label: cycleLabel(cycle) }));
  const people = [...assignable];
  // Someone who left the team may still be on the task: keep their name in the pickers.
  for (const extra of [{ id: task.assigneePersonId, fullName: detail.assigneeName }, ...detail.collaborators.map((person) => ({ id: person.id, fullName: person.name }))]) {
    if (extra.id && extra.fullName && !people.some((person) => person.id === extra.id)) people.push({ id: extra.id, fullName: extra.fullName });
  }

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {t("title")}
          </Link>
          {" / "}
          <Link href={project ? `/work/projects/${project.id}` : `/work/teams/${team.id}`} className="underline">
            {project?.name ?? team.name}
          </Link>
          {detail.parent ? (
            <>
              {" / "}
              <Link href={`/work/tasks/${detail.parent.id}`} className="underline">
                {detail.parent.key} {detail.parent.title}
              </Link>
            </>
          ) : null}
        </p>
        <p className="font-mono text-sm text-muted-foreground">{detail.key}</p>
      </header>
      {inTriage ? <TriageBanner teamId={team.id} status={work.triageStatus!} until={work.triageSnoozedUntil} /> : null}
      <TaskDetailView
        task={{
          id: task.id,
          key: detail.key,
          teamId: team.id,
          projectId: work.projectId,
          title: task.title,
          description: task.description,
          stateId: work.stateId,
          status: task.status,
          assigneePersonId: task.assigneePersonId,
          requesterName: detail.requesterName,
          createdByName: detail.createdByName,
          createdAt: task.createdAt.toISOString(),
          priority: task.priority,
          startDate: task.startDate,
          dueDate: task.dueDate,
          estimateMinutes: task.estimateMinutes,
          clientId: work.clientId,
          channel: work.channel,
          contentFormat: work.contentFormat,
          labelIds: detail.labelIds,
          collaboratorIds: detail.collaborators.map((person) => person.id),
          checklist: work.checklist,
          links: work.links,
          cycleId: work.cycleId,
        }}
        options={{
          states: states.map(({ id, name, isActive }) => ({ id, name, isActive })),
          people,
          labels: labels.map(({ id, name, color }) => ({ id, name, color })),
          clients: clients.map(({ id, name }) => ({ id, name })),
          projects,
          linkable: siblings.filter((row) => !linkedIds.has(row.id)),
          cycles,
        }}
        subtasks={detail.subtasks.map(({ id, key, title, status, stateId, assigneeName, dueDate }) => ({ id, key, title, status, stateId, assigneeName, dueDate }))}
        linked={detail.linked}
        canEdit={canEdit}
        canDelete={canDeleteTask(viewer, detail.facts)}
      >
        <TaskCustomFields taskId={task.id} fields={toFieldViews(fields)} values={work.customValues} people={people} canEdit={canEdit} />
        <BlockerPanel
          taskId={task.id}
          blockers={blockers.map((blocker) => ({ ...blocker, raisedAt: blocker.raisedAt.toISOString(), resolvedAt: blocker.resolvedAt?.toISOString() ?? null }))}
          people={people}
          canRaise={canRaiseBlocker(viewer, detail.facts)}
          canResolve={!!openBlocker && canResolveBlocker(viewer, detail.facts, openBlocker)}
          closed={task.status === "done" || task.status === "cancelled"}
        />
        <TaskFiles
          taskId={task.id}
          files={files.map((file) => ({ id: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, uploadedByName: file.uploadedByName, createdAt: file.createdAt.toISOString(), canRemove: moderate || (canEdit && file.uploadedByPersonId === user.person.id) }))}
          canAdd={canEdit}
          accept={acceptAttributeFor(TASK_FILE_OWNER)}
        />
        <TaskReview
          taskId={task.id}
          status={work.reviewStatus}
          rounds={work.revisionRounds}
          reviewerPersonId={work.reviewerPersonId}
          deliverables={deliverables.map(({ submittedAt, decidedAt, stageDueAt, frozenAt, decisions, ...item }) => ({
            ...item,
            submittedAt: submittedAt.toISOString(),
            decidedAt: decidedAt?.toISOString() ?? null,
            stageDueAt: stageDueAt?.toISOString() ?? null,
            frozenAt: frozenAt?.toISOString() ?? null,
            decisions: decisions.map(({ createdAt, ...decision }) => ({ ...decision, createdAt: createdAt.toISOString() })),
            pins: pins.filter((pin) => pin.deliverableId === item.id).map((pin) => ({ id: pin.id, x: pin.x, y: pin.y, timecodeMs: pin.timecodeMs, body: pin.body, authorName: pin.authorName, resolved: !!pin.resolvedAt, createdAt: pin.createdAt.toISOString(), canResolve: canResolvePin(viewer, detail.facts, pin) })),
          }))}
          files={files.map(({ id, fileName }) => ({ id, fileName }))}
          people={people}
          canSubmit={canSubmitDeliverable(viewer, detail.facts) && task.status !== "cancelled"}
          canDecide={canDecide}
          canEdit={canEdit}
          canRecordClient={canRecordClientDecision(viewer, detail.facts, client)}
          canPin={canPinFeedback(viewer, detail.facts)}
          clientName={client.name}
          today={today}
        />
        <PreviewLinkPanel
          taskId={task.id}
          links={previewLinks.map((link) => ({
            ...link,
            expiresAt: link.expiresAt.toISOString(),
            lastViewedAt: link.lastViewedAt?.toISOString() ?? null,
            createdAt: link.createdAt.toISOString(),
            decision: link.decision ? { ...link.decision, at: link.decision.at.toISOString() } : null,
            canRevoke: canRevokePreviewLink(viewer, detail.facts, client),
          }))}
          versions={deliverables.filter((item) => item.decision !== "superseded").map((item) => ({ id: item.id, version: item.version, frozen: !!item.frozenAt }))}
          canManage={managesPreview && task.status !== "cancelled"}
        />
        <DeliveryPanel
          taskId={task.id}
          deliveries={deliveries.map((item) => ({ id: item.id, version: item.version, deliveredOn: item.deliveredOn, recipient: item.recipient, links: item.links, note: item.note, deliveredByName: item.deliveredByName, canRemove: (item.deliveredByPersonId === user.person.id && canRecordDelivery(viewer, detail.facts)) || moderate }))}
          versions={deliverables.filter((item) => item.decision !== "superseded").map((item) => ({ id: item.id, version: item.version, approved: item.decision === "approved", frozen: !!item.frozenAt }))}
          canRecord={canRecordDelivery(viewer, detail.facts)}
          today={today}
        />
        {work.channel || publishes.length ? (
          <PublishPanel
            taskId={task.id}
            channel={work.channel}
            publishes={publishes.map((item) => ({ id: item.id, platform: item.platform, page: item.page, status: item.status, plannedAt: item.plannedAt?.toISOString() ?? null, publishedAt: item.publishedAt?.toISOString() ?? null, url: item.url, boosted: item.boosted, adAccount: item.adAccount, publishedByName: item.publishedByName, latest: item.latest, results: item.results.map(({ id, recordedOn, metrics, source }) => ({ id, recordedOn, metrics, source })) }))}
            canManage={canManagePublish(viewer, detail.facts) && task.status !== "cancelled"}
            today={today}
            now={new Date().toISOString()}
          />
        ) : null}
        <HandoffPanel
          taskId={task.id}
          taskTitle={task.title}
          handoffs={handoffs.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
            respondedAt: item.respondedAt?.toISOString() ?? null,
            fileName: item.fileId ? (files.find((file) => file.id === item.fileId)?.fileName ?? null) : null,
            canRespond: canRespondToHandoff(viewer, detail.facts, item),
          }))}
          teams={sendTeams}
          canSend={canEdit && task.status !== "cancelled"}
        />
        <FollowButton taskId={task.id} state={followStateOf(detail, user.person.id)} followers={followersOf(detail).length} />
        <TaskDiscussion
          taskId={task.id}
          comments={comments.map((comment) => ({ ...comment, createdAt: comment.createdAt.toISOString(), editedAt: comment.editedAt?.toISOString() ?? null }))}
          activity={activity.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }))}
          people={mentionable}
          selfId={user.person.id}
          canModerate={moderate}
        />
        <MovePanel taskId={task.id} taskKey={detail.key} teams={moveTargets} />
      </TaskDetailView>
    </div>
  );
}
