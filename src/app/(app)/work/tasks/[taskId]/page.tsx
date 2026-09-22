import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { canDecideReview, canDeleteTask, canEditTask, canModerateTask, canSubmitDeliverable, listDeliverables, followersOf, followStateOf, getTaskDetail, listActivity, listComments, listMentionable, listTaskFiles, listAssignable, listClients, listLabels, listLinkableTasks, listProjectOptions, listStates, loadViewer } from "@/modules/work/service";
import { TaskDetailView } from "@/modules/work/ui/task-detail";
import { FollowButton, TaskDiscussion, TaskFiles } from "@/modules/work/ui/task-discussion";
import { TaskReview } from "@/modules/work/ui/task-review";

export const metadata: Metadata = { title: "Task" };

export default async function TaskPage({ params }: PageProps<"/work/tasks/[taskId]">) {
  const user = await requireUser();
  const { taskId } = await params;
  const viewer = await loadViewer(user);
  // Not found and not allowed look the same from outside.
  const detail = /^[0-9a-f-]{36}$/.test(taskId) ? await getTaskDetail(taskId, viewer) : undefined;
  if (!detail) notFound();
  const { task, work, team, project } = detail;
  const t = await getTranslations("work");
  const canEdit = canEditTask(viewer, detail.facts);

  const moderate = canModerateTask(viewer, detail.facts);
  const [states, labels, clients, assignable, projects, siblings, activity, comments, files, mentionable, deliverables] = await Promise.all([
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
  ]);
  const linkedIds = new Set([task.id, ...detail.linked.map((link) => link.id)]);
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
        }}
        options={{
          states: states.map(({ id, name, isActive }) => ({ id, name, isActive })),
          people,
          labels: labels.map(({ id, name, color }) => ({ id, name, color })),
          clients: clients.map(({ id, name }) => ({ id, name })),
          projects,
          linkable: siblings.filter((row) => !linkedIds.has(row.id)),
        }}
        subtasks={detail.subtasks.map(({ id, key, title, status, stateId, assigneeName, dueDate }) => ({ id, key, title, status, stateId, assigneeName, dueDate }))}
        linked={detail.linked}
        canEdit={canEdit}
        canDelete={canDeleteTask(viewer, detail.facts)}
      >
        <TaskFiles
          taskId={task.id}
          files={files.map((file) => ({ id: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, uploadedByName: file.uploadedByName, createdAt: file.createdAt.toISOString(), canRemove: moderate || (canEdit && file.uploadedByPersonId === user.person.id) }))}
          canAdd={canEdit}
          accept={ACCEPT_ATTRIBUTE}
        />
        <TaskReview
          taskId={task.id}
          status={work.reviewStatus}
          rounds={work.revisionRounds}
          reviewerPersonId={work.reviewerPersonId}
          deliverables={deliverables.map(({ submittedAt, decidedAt, ...item }) => ({ ...item, submittedAt: submittedAt.toISOString(), decidedAt: decidedAt?.toISOString() ?? null }))}
          files={files.map(({ id, fileName }) => ({ id, fileName }))}
          people={people}
          canSubmit={canSubmitDeliverable(viewer, detail.facts) && task.status !== "cancelled"}
          canDecide={canDecideReview(viewer, detail.facts, { reviewerPersonId: work.reviewerPersonId, submittedByPersonId: deliverables.find((item) => item.decision === "pending")?.submittedByPersonId ?? null })}
          canEdit={canEdit}
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
      </TaskDetailView>
    </div>
  );
}
