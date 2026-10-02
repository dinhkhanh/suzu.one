import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/ui/page";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { RecordLink } from "@/components/ui/record-link";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canAddRaid, canBecomeTask, canCloseRaidItem, canEditRaidItem, listRaid, meetingPeople, openProject, RAID_KINDS, type RaidKind, raidCounts } from "@/modules/projects/service";
import { IssueToTaskForm, RaidEdit, RaidEvidenceLink, RaidForm, RaidStatusButton } from "@/modules/projects/ui/collab-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

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
    <Page>
      <ProjectHeader context={context} current="risks" />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2>{t("title")}</h2>
          {counts.highRisks > 0 ? <Badge variant="destructive">{t("portfolio.highRisksBadge", { count: counts.highRisks })}</Badge> : null}
          {counts.openIssues > 0 ? <Badge variant="warning">{t("portfolio.openIssuesBadge", { count: counts.openIssues })}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <nav aria-label={t("filterLabel")} className="tab-row -mx-4 px-4 md:mx-0 md:px-0">
          {[null, ...RAID_KINDS].map((value) => (
            <Link key={value ?? "all"} href={tab(value)} aria-current={value === kind ? "page" : undefined}>
              {value ? t(`kindsPlural.${value}`) : t("all")}
              <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{value ? all.filter((item) => item.kind === value).length : all.length}</span>
            </Link>
          ))}
        </nav>

        <TableCard>
          <List>
            {items.length === 0 ? <ListEmpty>{t("none")}</ListEmpty> : null}
            {items.map((item) => {
              const open = item.status === "open";
              const rights = { ownerPersonId: item.ownerPersonId, createdByPersonId: item.createdByPersonId };
              return (
                <ListItem key={item.id} className={`flex-col items-stretch gap-2 py-4 ${open ? "" : "opacity-70"}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{t(`kinds.${item.kind as RaidKind}`)}</Badge>
                    {item.severity ? <Badge variant={severityVariant(item.severity)}>{t(`severities.${item.severity as "high"}`)}</Badge> : null}
                    <Badge dot variant={open ? "info" : "secondary"}>{t(`statuses.${item.status as "open"}`)}</Badge>
                  </div>
                  <p className="font-medium">{item.title}</p>
                  <RichText text={item.description} className="text-sm text-muted-foreground" />
                  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs text-muted-foreground">{t("fields.owner")}</dt>
                      <dd>{item.ownerName ? <RecordLink kind="person" id={item.ownerPersonId}>{item.ownerName}</RecordLink> : "—"}</dd>
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
                      <dd>{item.authorName ? <RecordLink kind="person" id={item.createdByPersonId}>{item.authorName}</RecordLink> : "—"}</dd>
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
                      <RecordLink kind="task" id={item.task.id} className="underline">
                        <span className="font-mono text-xs">{item.task.key}</span> {item.task.title}
                      </RecordLink>
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
                </ListItem>
              );
            })}
          </List>
          {adds ? (
            <TableAddRow label={t("new")} open={items.length === 0}>
              <RaidForm projectId={project.id} people={people} today={today} />
            </TableAddRow>
          ) : null}
        </TableCard>
      </section>
    </Page>
  );
}
