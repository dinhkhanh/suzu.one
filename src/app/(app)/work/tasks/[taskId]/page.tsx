import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Page } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { acceptAttributeFor } from "@/modules/platform/files/rules";
import { canDecideReview, canDeleteTask, canEditTask, canModerateTask, canRaiseBlocker, canResolveBlocker, canSubmitDeliverable, listDeliverables, followersOf, followStateOf, getTaskDetail, listActivity, listComments, listCustomFields, listMentionable, listMoveTargets, listTaskBlockers, listTaskFiles, listAssignable, listClients, listLabels, listLinkableTasks, listProjectOptions, listStates, loadViewer, resolveTaskKey, toFieldViews } from "@/modules/work/service";
import { TaskCustomFields } from "@/modules/work/ui/custom-fields";
import { BlockerPanel, MovePanel, TriageBanner } from "@/modules/work/ui/task-foundation";
import { TaskDetailView } from "@/modules/work/ui/task-detail";
import { FollowButton, TaskDiscussion, TaskFiles } from "@/modules/work/ui/task-discussion";
import { TaskReview } from "@/modules/work/ui/task-review";
import { canRespondToHandoff, canSendToTeam, listOpenCycles, listTaskHandoffs, listTeamCycles, listTeams, projectFacts, TASK_FILE_OWNER, teamFacts } from "@/modules/work/service";
import { HandoffPanel } from "@/modules/work/ui/handoff";
import { todayInVietnam } from "@/lib/dates";
import { canDecideStage, canManagePublish, canManagePreviewLinks, canPinFeedback, canRecordClientDecision, canRecordDelivery, canResolvePin, canRevokePreviewLink, clientOfTask, listDeliveriesByTask, listPreviewLinks, listPublishesByTask, listTaskPins } from "@/modules/work/service";
import { checklistChoices, listStateChecklists } from "@/modules/work/service";
import { DeliveryPanel } from "@/modules/work/ui/delivery";
import { auditPrivateTaskRead, getTaskLine, jobNumbersOf } from "@/modules/projects/service";
import { TaskLineField } from "@/modules/projects/ui/task-line";
import { contactChoicesFor } from "@/modules/crm/service";
import { PreviewLinkPanel } from "@/modules/work/ui/preview-links";
import { PublishPanel } from "@/modules/work/ui/publish";
import { digitalAssetsByProject, listLinkableDigitalAssets } from "@/modules/work/service";
import { TaskDigitalAssets } from "@/modules/work/ui/digital-assets";
import { activeAccessPairs } from "@/modules/assets/service";
import { accentOf } from "@/modules/work/enums";
import { getTaskTime, loadTimeReader } from "@/modules/daily/service";
import { TaskTime } from "@/modules/daily/ui/task-time";
import { pageTitle } from "@/i18n/page-title";
import { proposalDraft } from "@/modules/ai/service";

export const generateMetadata = pageTitle("task");

export default async function TaskPage({ params, searchParams }: PageProps<"/work/tasks/[taskId]">) {
  const user = await requireUser();
  const { taskId } = await params;
  const { proposal } = await searchParams;
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
  // A leader reading the work of a private project they are none of the people of leaves the same
  // trail here as on its board (Q25): a task opens from a link, a key or a notice, without the board.
  await auditPrivateTaskRead(viewer, detail);
  const t = await getTranslations("work");
  const canEdit = canEditTask(viewer, detail.facts);
  // Sửa on the assistant's proposal of a comment or a blocker on this task: the form opens filled in.
  const draft = await proposalDraft(user.person.id, typeof proposal === "string" ? proposal : null, ["work.comment.add", "work.blocker.raise", "work.blocker.resolve"]);
  const drafted = draft && draft.taskId === task.id ? draft : null;
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);

  const moderate = canModerateTask(viewer, detail.facts);
  const [handoffs, allTeams, openCycles, teamCycles] = await Promise.all([listTaskHandoffs(task.id, viewer), canEdit ? listTeams() : [], listOpenCycles([team.id]), work.cycleId ? listTeamCycles(team.id) : []]);
  const [states, labels, clients, assignable, projects, siblings, activity, comments, files, mentionable, deliverables, fields, blockers, moveTargets] = await Promise.all([
    listStates([team.id]),
    listLabels([team.id]),
    listClients({ activeOnly: true }),
    listAssignable(team.id, work.projectId),
    canEdit ? listProjectOptions(viewer, team.id) : [],
    canEdit ? listLinkableTasks({ projectId: work.projectId, teamId: team.id, subtreeOf: task.id }) : [],
    listActivity(task.id),
    listComments(task.id),
    listTaskFiles(task.id),
    listMentionable(detail),
    listDeliverables(task.id),
    listCustomFields({ teamId: team.id, projectId: work.projectId }),
    listTaskBlockers(task.id),
    canEdit ? listMoveTargets(viewer, detail.facts) : [],
  ]);
  // Time is logged where the work is (D22, FR-PJM-37): the daily module's own log and timer, and
  // the hours its access rule lets this reader see. Whoever opens the task may log on it.
  // The project layer's two facts about the work, composed here because work cannot import it:
  // the job number beside the project's name (FR-PJM-02), and the register line this task fills.
  const [pins, deliveries, publishes, client, checklists, stageHooks, time, jobNumbers, registerLine] = await Promise.all([
    listTaskPins(task.id),
    listDeliveriesByTask([task.id]),
    listPublishesByTask([task.id]),
    clientOfTask(detail),
    checklistChoices(),
    listStateChecklists([work.stateId]),
    loadTimeReader(user.person.id, user.principal).then((reader) => getTaskTime(reader, { taskId: task.id, projectId: work.projectId }, todayInVietnam())),
    jobNumbersOf([project?.id]),
    project ? getTaskLine(viewer, projectFacts(project, team), task.id) : null,
  ]);
  const jobNumber = project ? (jobNumbers.get(project.id) ?? null) : null;
  // FR-AST-09: the pages and channels the task may name — the project's own first, then the rest;
  // what the task already names stays in the list even once retired, so saving does not drop it.
  const [linkable, ofProject, accessPairs] = await Promise.all([
    listLinkableDigitalAssets(),
    work.projectId ? digitalAssetsByProject([work.projectId]).then((byProject) => byProject.get(work.projectId!) ?? []) : [],
    task.assigneePersonId ? activeAccessPairs(detail.digitalAssets.map((asset) => asset.id), [task.assigneePersonId]) : new Set<string>(),
  ]);
  const firstIds = new Set(ofProject.map((asset) => asset.id));
  const digitalOptions = [...ofProject.filter((asset) => asset.status !== "retired"), ...linkable.filter((asset) => !firstIds.has(asset.id)), ...detail.digitalAssets.filter((asset) => asset.status === "retired")].map(({ id, name, platform }) => ({ id, name, platform }));
  const recordsClient = canRecordClientDecision(viewer, detail.facts, client);
  const clientContacts = recordsClient ? await contactChoicesFor(client.id) : [];
  const stageChecklists = stageHooks.flatMap((hook) => {
    const list = checklists.find((choice) => choice.id === hook.checklistId);
    return list ? [{ id: list.id, name: list.name, required: hook.required }] : [];
  });
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

  const crumb = (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <Link href="/work" className="hover:underline">
        {t("title")}
      </Link>
      <span className="text-faint">/</span>
      <Link href={project ? `/work/projects/${project.id}` : `/work/teams/${team.id}`} className="hover:underline">
        {jobNumber ? <span className="mr-1.5 font-mono text-xs text-faint">{jobNumber}</span> : null}
        {project?.name ?? team.name}
      </Link>
      {detail.parent ? (
        <>
          <span className="text-faint">/</span>
          <RecordLink kind="task" id={detail.parent.id}>
            <span className="font-mono text-xs">{detail.parent.key}</span> {detail.parent.title}
          </RecordLink>
        </>
      ) : null}
      <span className="text-faint">/</span>
      <span className="font-mono text-xs text-foreground">{detail.key}</span>
    </span>
  );

  return (
    <Page width="wide" className="gap-4 md:gap-5" data-accent={accentOf(project?.color, team.color)}>
      <p className="text-[0.8125rem] font-medium text-muted-foreground">{crumb}</p>
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
          requesterPersonId: task.requesterPersonId,
          requesterName: detail.requesterName,
          createdByPersonId: task.createdByPersonId,
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
          digitalAssetIds: detail.digitalAssets.map((asset) => asset.id),
          collaboratorIds: detail.collaborators.map((person) => person.id),
          checklist: work.checklist,
          links: work.links,
          cycleId: work.cycleId,
          parentTaskId: task.parentTaskId,
        }}
        options={{
          states: states.map(({ id, name, isActive }) => ({ id, name, isActive })),
          people,
          labels: labels.map(({ id, name, color }) => ({ id, name, color })),
          clients: clients.map(({ id, name }) => ({ id, name })),
          projects,
          digitalAssets: digitalOptions,
          linkable: siblings.filter((row) => !linkedIds.has(row.id)).map(({ id, key, title }) => ({ id, key, title })),
          // "Parent task": any open task of the same list but this one and what sits under it — and the
          // parent it has now, which stays in the picker even when closed, so saving does not drop it.
          // Not offered where the parent is one the viewer cannot see: the picker could not hold it.
          parents: task.parentTaskId && !detail.parent ? undefined : [...(detail.parent && !siblings.some((row) => row.id === detail.parent!.id) ? [{ id: detail.parent.id, key: detail.parent.key, title: detail.parent.title }] : []), ...siblings.filter((row) => !row.under).map(({ id, key, title }) => ({ id, key, title }))],
          cycles,
          checklists,
          stageChecklists,
        }}
        subtasks={detail.subtasks.map(({ id, key, title, status, stateId, assigneePersonId, assigneeName, dueDate }) => ({ id, key, title, status, stateId, assigneePersonId, assigneeName, dueDate }))}
        linked={detail.linked}
        canEdit={canEdit}
        canDelete={canDeleteTask(viewer, detail.facts)}
        today={today}
      >
        <TaskCustomFields taskId={task.id} fields={toFieldViews(fields)} values={work.customValues} people={people} canEdit={canEdit} />
        <TaskTime taskId={task.id} today={today} earliest={time.earliest} billable={time.billable} running={time.running} mine={time.mine} total={time.total} />
        {registerLine ? <TaskLineField taskId={task.id} current={registerLine.current} options={registerLine.options.map(({ id, label }) => ({ id, label }))} canEdit={registerLine.canEdit} /> : null}
        <BlockerPanel
          taskId={task.id}
          blockers={blockers.map((blocker) => ({ ...blocker, raisedAt: blocker.raisedAt.toISOString(), resolvedAt: blocker.resolvedAt?.toISOString() ?? null }))}
          people={people}
          canRaise={canRaiseBlocker(viewer, detail.facts)}
          canResolve={!!openBlocker && canResolveBlocker(viewer, detail.facts, openBlocker)}
          closed={task.status === "done" || task.status === "cancelled"}
          draft={drafted && (text(drafted.reason) || text(drafted.resolution)) ? { reason: text(drafted.reason), neededPersonId: text(drafted.neededPersonId) ?? null, resolution: text(drafted.resolution) ?? null } : undefined}
        />
        <TaskFiles
          taskId={task.id}
          files={files.map((file) => ({ id: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, uploadedByPersonId: file.uploadedByPersonId, uploadedByName: file.uploadedByName, createdAt: file.createdAt.toISOString(), canRemove: moderate || (canEdit && file.uploadedByPersonId === user.person.id) }))}
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
            pins: pins.filter((pin) => pin.deliverableId === item.id).map((pin) => ({ id: pin.id, x: pin.x, y: pin.y, timecodeMs: pin.timecodeMs, body: pin.body, authorPersonId: pin.authorPersonId, authorName: pin.authorName, resolved: !!pin.resolvedAt, createdAt: pin.createdAt.toISOString(), canResolve: canResolvePin(viewer, detail.facts, pin) })),
          }))}
          files={files.map(({ id, fileName }) => ({ id, fileName }))}
          people={people}
          canSubmit={canSubmitDeliverable(viewer, detail.facts) && task.status !== "cancelled"}
          canDecide={canDecide}
          canEdit={canEdit}
          canRecordClient={recordsClient}
          canPin={canPinFeedback(viewer, detail.facts)}
          clientName={client.name}
          clientContacts={clientContacts}
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
          deliveries={deliveries.map((item) => ({ id: item.id, version: item.version, deliveredOn: item.deliveredOn, recipient: item.recipient, links: item.links, note: item.note, deliveredByPersonId: item.deliveredByPersonId, deliveredByName: item.deliveredByName, canRemove: (item.deliveredByPersonId === user.person.id && canRecordDelivery(viewer, detail.facts)) || moderate }))}
          versions={deliverables.filter((item) => item.decision !== "superseded").map((item) => ({ id: item.id, version: item.version, approved: item.decision === "approved", frozen: !!item.frozenAt }))}
          canRecord={canRecordDelivery(viewer, detail.facts)}
          today={today}
        />
        <TaskDigitalAssets
          assets={detail.digitalAssets.map((asset) => ({ ...asset, assigneeHasAccess: task.assigneePersonId ? accessPairs.has(`${asset.id}:${task.assigneePersonId}`) : null }))}
          assigneeName={detail.assigneeName}
        />
        {work.channel || publishes.length || detail.digitalAssets.length ? (
          <PublishPanel
            taskId={task.id}
            channel={work.channel}
            accounts={digitalOptions}
            defaultAccountId={detail.digitalAssets.length === 1 && detail.digitalAssets[0].status !== "retired" ? detail.digitalAssets[0].id : null}
            publishes={publishes.map((item) => ({ id: item.id, platform: item.platform, page: item.page, digitalAssetId: item.digitalAssetId, status: item.status, plannedAt: item.plannedAt?.toISOString() ?? null, publishedAt: item.publishedAt?.toISOString() ?? null, url: item.url, boosted: item.boosted, adAccount: item.adAccount, publishedByPersonId: item.publishedByPersonId, publishedByName: item.publishedByName, latest: item.latest, results: item.results.map(({ id, recordedOn, metrics, source }) => ({ id, recordedOn, metrics, source })) }))}
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
          draft={text(drafted?.body)}
        />
        <MovePanel taskId={task.id} taskKey={detail.key} teams={moveTargets} />
      </TaskDetailView>
    </Page>
  );
}
