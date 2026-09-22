import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { canManageInstance, canReadOps, canViewInstance, canWorkInstance, escalationLevelOf, listEvidenceFiles, loadInstance, periodLabel, personNamesOf, statusColour } from "@/modules/ops/service";
import { InstancePanel, ReassignForm } from "@/modules/ops/ui/instance-panel";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";

export const metadata: Metadata = { title: "Obligation" };

// One obligation instance: what to do, by when, and the proof that it was done (FR-OPS-05). The id is the task's.
export default async function ObligationPage({ params }: PageProps<"/ops/obligations/[taskId]">) {
  const user = await requireUser();
  const { taskId } = await params;
  const loaded = /^[0-9a-f-]{36}$/.test(taskId) ? await loadInstance(taskId) : undefined;
  if (!loaded || !canViewInstance(user.principal, loaded.parties)) notFound();

  const { instance, task, template } = loaded;
  const t = await getTranslations("ops");
  const format = await getFormatter();
  const today = todayInVietnam();
  const canWork = canWorkInstance(user.principal, loaded.parties);
  const canManage = canManageInstance(user.principal, loaded.parties);
  const open = task.status === "todo" || task.status === "in_progress";
  const [level, files, entity, names, people] = await Promise.all([
    open ? escalationLevelOf(instance.id) : 0,
    listEvidenceFiles(instance.id),
    listEntities().then((entities) => entities.find((row) => row.id === instance.entityId)),
    personNamesOf([task.assigneePersonId, instance.reviewerPersonId, task.subjectPersonId, task.completedByPersonId]),
    canManage && open ? listPersonNames() : [],
  ]);
  const named = (id: string | null) => (id && names.has(id) ? { fullName: names.get(id)! } : undefined);
  const [owner, reviewer, subject, completedBy] = [named(task.assigneePersonId), named(instance.reviewerPersonId), named(task.subjectPersonId), named(task.completedByPersonId)];
  // Uploaders are mostly the owner or reviewer, already named above; the rest in one query.
  const uploaders = new Map([...names, ...(await personNamesOf(files.map((file) => file.uploadedByPersonId).filter((id) => id && !names.has(id))))]);
  const day = (date: string) => format.dateTime(new Date(`${date}T00:00:00`), { dateStyle: "medium" });
  const colour = statusColour({ status: task.status, dueDate: task.dueDate, completedLate: instance.completedLate }, today);
  const facts: [string, string][] = [
    [t("instance.entity"), entity?.code ?? "—"],
    [t("instance.period"), instance.periodKey.startsWith("event:") ? t("instance.eventDriven") : periodLabel(instance.periodKey)],
    [t("instance.dueDate"), task.dueDate ? (task.dueDate === instance.nominalDueDate ? day(task.dueDate) : t("instance.dueShifted", { date: day(task.dueDate), nominal: day(instance.nominalDueDate) })) : "—"],
    [t("instance.owner"), owner?.fullName ?? t("unassigned")],
    [t("instance.reviewer"), reviewer?.fullName ?? "—"],
    [t("library.authority"), t(`enums.authority.${template.authority}`)],
    ...(subject ? ([[t("instance.subject"), subject.fullName]] as [string, string][]) : []),
    ...(task.completedAt ? ([[t("instance.completed"), `${format.dateTime(task.completedAt, { dateStyle: "medium" })}${completedBy ? ` · ${completedBy.fullName}` : instance.note === "system:timesheet_locked" ? ` · ${t("instance.bySystem")}` : ""}`]] as [string, string][]) : []),
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/ops" className="underline">
            {t("title")}
          </Link>
        </p>
        <h1>{task.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge colour={colour} label={t(`enums.colour.${colour}`)} />
          <Badge variant="outline">{t(`enums.category.${template.category}`)}</Badge>
          {level > 0 ? <Badge variant="destructive">{t(`escalation.level${level}`)}</Badge> : null}
          {template.reviewStatus !== "reviewed" ? <Badge variant="outline">{t("unreviewed")}</Badge> : null}
          {canReadOps(user.principal, instance.entityId) ? (
            <Link href={`/ops/history?template=${template.id}&entity=${instance.entityId}&year=all`} className="text-xs underline">
              {t("history.ofThis")}
            </Link>
          ) : null}
        </div>
        {template.reviewStatus !== "reviewed" ? <p className="text-xs text-muted-foreground">{t("unreviewedNote")}</p> : null}
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border p-4 text-sm sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {template.guidance || template.penaltyNote || template.links.length ? (
        <section className="flex flex-col gap-2 text-sm">
          <h2 className="text-sm font-medium text-muted-foreground">{t("instance.guidance")}</h2>
          {template.guidance ? <p className="whitespace-pre-line">{template.guidance}</p> : null}
          {template.penaltyNote ? <p className="text-destructive">{t("instance.penalty", { note: template.penaltyNote })}</p> : null}
          {template.links.length ? (
            <ul className="list-disc pl-5">
              {template.links.map((link) => (
                <li key={link.url}>
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {link.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {instance.reopenReason ? <p className="text-sm text-muted-foreground">{t("instance.reopened", { reason: instance.reopenReason })}</p> : null}

      <InstancePanel
        taskId={task.id}
        open={open}
        canWork={canWork}
        canManage={canManage}
        checklist={template.checklist}
        checklistState={instance.checklistState}
        required={template.evidence}
        evidence={{ referenceNumber: instance.referenceNumber, submittedDate: instance.submittedDate, amountPaid: instance.amountPaid, note: instance.note === "system:timesheet_locked" ? t("instance.timesheetLocked") : instance.note }}
        files={files.map((file) => ({ id: file.id, fileName: file.fileName, sizeBytes: file.sizeBytes, uploadedByName: file.uploadedByPersonId ? (uploaders.get(file.uploadedByPersonId) ?? null) : null, createdAt: file.createdAt.toISOString(), canRemove: canManage || (canWork && file.uploadedByPersonId === user.person.id) }))}
        accept={ACCEPT_ATTRIBUTE}
        today={today}
      />

      {canManage && open ? (
        <section className="flex flex-col gap-2 border-t pt-4">
          <h2 className="text-sm font-medium text-muted-foreground">{t("instance.people")}</h2>
          <ReassignForm taskId={task.id} people={people} assigneePersonId={task.assigneePersonId} reviewerPersonId={instance.reviewerPersonId} />
        </section>
      ) : null}
    </div>
  );
}
