import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { jobNumbersOf } from "@/modules/projects/service";
import { getLeaderView, loadViewer } from "@/modules/work/service";
import { NudgeButton } from "@/modules/work/ui/planning-forms";
import { StateBadge } from "@/modules/work/ui/status-badge";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("leaderView");

// FR-WRK-07: what other people are doing for me — by person, trouble first, with a one-click nudge.
export default async function LeaderPage() {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const t = await getTranslations("work.leader");
  const tWork = await getTranslations("work");
  const format = await getFormatter();
  const today = todayInVietnam();
  const view = await getLeaderView(viewer, today);
  // The job number beside each project's name (FR-PJM-02): every project on the page in one read.
  const jobNumbers = await jobNumbersOf(view.people.flatMap((person) => person.tasks.map((task) => task.projectId)));
  const head = (
    <TableHeader>
      <TableRow>
        <TableHead kind="id">{tWork("table.key")}</TableHead>
        <TableHead kind="text">{tWork("table.title")}</TableHead>
        <TableHead kind="select">{tWork("task.fields.project")}</TableHead>
        <TableHead kind="status">{tWork("task.fields.state")}</TableHead>
        <TableHead kind="date">{tWork("task.fields.dueDate")}</TableHead>
        <TableHead kind="select">{t("columns.relation")}</TableHead>
        <TableHead kind="status">{t("columns.risk")}</TableHead>
        <TableHead kind="actions" />
      </TableRow>
    </TableHeader>
  );

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <Link href="/work" className="hover:underline">
            {tWork("title")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      >
        <p className="flex flex-wrap gap-1.5 pt-1 text-sm">
          <Badge variant="outline">{t("open", { count: view.totals.open })}</Badge>
          {view.totals.blocked ? <Badge variant="destructive">{t("flagged", { count: view.totals.blocked })}</Badge> : null}
          <Badge variant={view.totals.overdue ? "destructive" : "outline"}>{t("overdue", { count: view.totals.overdue })}</Badge>
          <Badge variant={view.totals.atRisk ? "warning" : "outline"}>{t("atRisk", { count: view.totals.atRisk })}</Badge>
        </p>
        {view.shown !== null ? <p className="text-sm text-muted-foreground">{t("truncated", { shown: view.shown, total: view.totals.open })}</p> : null}
      </PageHeader>
      {view.people.length === 0 ? (
        <Table>
          {head}
          <TableBody>
            <TableEmpty>{t("empty")}</TableEmpty>
          </TableBody>
        </Table>
      ) : null}
      {view.people.map((person) => (
        <TableCard key={person.personId ?? "none"}>
          <TableCardHeader
            title={person.name ? <RecordLink kind="person" id={person.personId}>{person.name}</RecordLink> : t("unassigned")}
            description={t("counts", person.counts)}
            actions={
              person.blocked || person.tasks[0]?.away || person.overdue || person.atRisk ? (
                <>
                  {person.blocked ? <Badge variant="destructive">{t("flagged", { count: person.blocked })}</Badge> : null}
                  {/* FR-PJM-44: on leave under a submitted cover plan. */}
                  {person.tasks[0]?.away ? <Badge variant="outline">{person.tasks[0].away.coverName ? tWork("cover.awayCovered", { name: person.tasks[0].away.coverName }) : tWork("cover.away")}</Badge> : null}
                  {person.overdue ? <Badge variant="destructive">{t("overdue", { count: person.overdue })}</Badge> : null}
                  {person.atRisk ? <Badge variant="secondary">{t("atRisk", { count: person.atRisk })}</Badge> : null}
                </>
              ) : null
            }
          />
          <Table>
            {head}
            <TableBody>
              {person.tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell kind="id">{task.key}</TableCell>
                  <TableCell className="max-w-96">
                    <RecordLink kind="task" id={task.id} className="block truncate font-medium">
                      {task.title}
                    </RecordLink>
                    {task.blocker ? <p className="truncate text-xs text-muted-foreground">{t("flaggedReason", { reason: task.blocker.neededName ? `${task.blocker.reason} (${tWork.markup("blockers.waitingOn", { name: task.blocker.neededName, who: (chunks) => chunks })})` : task.blocker.reason })}</p> : null}
                  </TableCell>
                  <TableCell>
                    {task.projectId && jobNumbers.get(task.projectId) ? <span className="mr-1.5 font-mono text-xs text-faint">{jobNumbers.get(task.projectId)}</span> : null}
                    {task.projectName ? <RecordLink kind="project" id={task.projectId}>{task.projectName}</RecordLink> : "—"}
                  </TableCell>
                  <TableCell>{task.stateName ? <StateBadge category={task.category} name={task.stateName} /> : "—"}</TableCell>
                  <TableCell>{task.dueDate ? format.dateTime(new Date(`${task.dueDate}T00:00:00`), { dateStyle: "medium" }) : "—"}</TableCell>
                  <TableCell>{t(`mine.${task.mine}`)}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {task.risk === "overdue" ? <Badge variant="destructive">{t("risk.overdue")}</Badge> : task.risk === "at_risk" ? <Badge variant="secondary">{t("risk.at_risk")}</Badge> : null}
                      {task.blockedBy ? <span className="text-xs text-muted-foreground">{t("blocked", { count: task.blockedBy })}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell kind="actions">{task.assigneePersonId ? <NudgeButton taskId={task.id} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ))}
    </Page>
  );
}
