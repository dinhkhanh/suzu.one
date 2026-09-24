import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canAddRaid, canBecomeTask, canCloseRaidItem, canEditRaidItem, listRaid, meetingPeople, openProject, RAID_KINDS, type RaidKind, raidCounts } from "@/modules/projects/service";
import { IssueToTaskForm, RaidEdit, RaidEvidenceLink, RaidForm, RaidStatusButton } from "@/modules/projects/ui/collab-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("risksDecisions");

const severityVariant = (severity: string | null) => (severity === "high" ? "destructive" : severity === "medium" ? "warning" : "secondary");

/**
 * Risks, issues, decisions and assumptions (FR-PJM-29). Every reader of the project reads the log;
 * the people working in it add to it; its lead, a team lead or an item's owner closes an item. An
 * open issue becomes a task in one step, and a decision shows when it was taken and its proof.
 */
export default async function ProjectRisksPage({ params, searchParams }: PageProps<"/projects/[projectId]/risks">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, viewer, facts } = context;
  const query = await searchParams;
  const kind = typeof query.kind === "string" && (RAID_KINDS as readonly string[]).includes(query.kind) ? (query.kind as RaidKind) : null;
  const adds = canAddRaid(viewer, facts);
  const [t, format, all, people] = await Promise.all([getTranslations("projects.raid"), getFormatter(), listRaid(project.id), adds ? meetingPeople(project.id) : Promise.resolve([])]);
  const items = kind ? all.filter((item) => item.kind === kind) : all;
  const counts = raidCounts(all);
  const today = todayInVietnam();
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : null);
  const tab = (value: RaidKind | null) => (value ? `/projects/${project.id}/risks?kind=${value}` : `/projects/${project.id}/risks`);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <ProjectHeader context={context} current="risks" />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">{t("title")}</h2>
          {counts.highRisks > 0 ? <Badge variant="destructive">{t("portfolio.highRisksBadge", { count: counts.highRisks })}</Badge> : null}
          {counts.openIssues > 0 ? <Badge variant="warning">{t("portfolio.openIssuesBadge", { count: counts.openIssues })}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <nav aria-label={t("filterLabel")} className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <ul className="flex w-max gap-1 text-sm">
            {[null, ...RAID_KINDS].map((value) => (
              <li key={value ?? "all"}>
                <Link href={tab(value)} aria-current={value === kind ? "page" : undefined} className={`block rounded-md border px-3 py-1 whitespace-nowrap ${value === kind ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}>
                  {value ? t(`kindsPlural.${value}`) : t("all")} ({value ? all.filter((item) => item.kind === value).length : all.length})
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
        <ul className="flex flex-col gap-3">
          {items.map((item) => {
            const open = item.status === "open";
            const rights = { ownerPersonId: item.ownerPersonId, createdByPersonId: item.createdByPersonId };
            return (
              <li key={item.id} className={`flex flex-col gap-2 rounded-xl border p-4 ${open ? "" : "opacity-70"}`}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{t(`kinds.${item.kind as RaidKind}`)}</Badge>
                  {item.severity ? <Badge variant={severityVariant(item.severity)}>{t(`severities.${item.severity as "high"}`)}</Badge> : null}
                  <Badge dot variant={open ? "info" : "secondary"}>{t(`statuses.${item.status as "open"}`)}</Badge>
                </div>
                <p className="font-medium">{item.title}</p>
                {item.description ? <p className="text-sm whitespace-pre-line text-muted-foreground">{item.description}</p> : null}
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("fields.owner")}</dt>
                    <dd>{item.ownerName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("fields.dueDate")}</dt>
                    <dd className={open && item.dueDate && item.dueDate < today ? "text-destructive" : undefined}>{date(item.dueDate) ?? "—"}</dd>
                  </div>
                  {item.kind === "decision" ? (
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("fields.decidedOn")}</dt>
                      <dd>{date(item.decidedOn) ?? "—"}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="text-xs text-muted-foreground">{t("fields.author")}</dt>
                    <dd>{item.authorName ?? "—"}</dd>
                  </div>
                </dl>
                {item.evidenceFile || item.evidenceUrl ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">{t("evidence")}</span>
                    {item.evidenceFile ? <RaidEvidenceLink projectId={project.id} fileId={item.evidenceFile.id} fileName={item.evidenceFile.fileName} /> : null}
                    {item.evidenceUrl ? (
                      <a href={item.evidenceUrl} target="_blank" rel="noopener noreferrer" className="break-all underline">
                        {item.evidenceUrl}
                      </a>
                    ) : null}
                  </p>
                ) : null}
                {item.meeting ? (
                  <p className="text-sm">
                    <span className="text-xs text-muted-foreground">{t("fromMeeting")} </span>
                    <Link href={`/projects/${project.id}/meetings/${item.meeting.id}`} className="underline">
                      {item.meeting.title} · {date(item.meeting.heldOn)}
                    </Link>
                  </p>
                ) : null}
                {item.task ? (
                  <p className="text-sm">
                    <span className="text-xs text-muted-foreground">{t("task")} </span>
                    <Link href={`/work/tasks/${item.task.id}`} className="underline">
                      <span className="font-mono text-xs">{item.task.key}</span> {item.task.title}
                    </Link>
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  {canCloseRaidItem(viewer, facts, rights) ? <RaidStatusButton itemId={item.id} open={open} /> : null}
                  {adds && canBecomeTask(item) ? <IssueToTaskForm itemId={item.id} people={people} ownerPersonId={item.ownerPersonId} dueDate={item.dueDate} /> : null}
                  {canEditRaidItem(viewer, facts, rights) ? (
                    <RaidEdit
                      projectId={project.id}
                      people={people}
                      today={today}
                      item={{ id: item.id, kind: item.kind as RaidKind, title: item.title, description: item.description, ownerPersonId: item.ownerPersonId, dueDate: item.dueDate, severity: item.severity, decidedOn: item.decidedOn, evidenceUrl: item.evidenceUrl, evidence: item.evidenceFile ? { fileId: item.evidenceFile.id, fileName: item.evidenceFile.fileName } : null }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {adds ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-base font-medium">{t("new")}</h2>
          <RaidForm projectId={project.id} people={people} today={today} />
        </section>
      ) : null}
    </div>
  );
}
