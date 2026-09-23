import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { canWriteClientReport, clientReportFigures, defaultReportPeriod, listClientReports, openProject, type ReportFigures } from "@/modules/projects/service";
import { ClientReportForm } from "@/modules/projects/ui/commercial-forms";
import { healthVariant, ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("clientReports");

/**
 * Client reports (FR-PJM-58): a period's figures — register, publishing and its results,
 * milestones reached, status updates — with the author's summary and plan for the next period,
 * as a PDF on the entity's letterhead. What the client reads never carries a fee, and internal
 * hours only when the author ticks "show hours".
 */
export default async function ProjectReportsPage({ params }: PageProps<"/projects/[projectId]/reports">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, viewer, facts } = context;
  const [t, tProjects, tWork, format, reports] = await Promise.all([getTranslations("projects.reports"), getTranslations("projects"), getTranslations("work"), getFormatter(), listClientReports(project.id)]);
  const figures = await Promise.all(reports.map((report) => clientReportFigures(project.id, { from: report.periodFrom, to: report.periodTo }, { showHours: report.showHours })));
  const write = canWriteClientReport(viewer, facts);
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const number = (value: number) => format.number(value);
  const period = defaultReportPeriod();

  const summary = (view: ReportFigures) => (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">{t("register")}</dt>
          <dd className="font-medium">{t("registerValue", { accepted: view.register.accepted, promised: view.register.promised })}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("published")}</dt>
          <dd className="font-medium">{number(view.publishing.count)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("reach")}</dt>
          <dd className="font-medium">{number(view.publishing.totals.reach)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("engagement")}</dt>
          <dd className="font-medium">{number(view.publishing.totals.engagement)}</dd>
        </div>
        {view.hours ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("hours")}</dt>
            <dd className="font-medium">{format.number(view.hours.loggedMinutes / 60, { maximumFractionDigits: 1 })}</dd>
          </div>
        ) : null}
      </dl>
      {view.lines.length ? (
        <ul className="flex flex-col gap-0.5">
          {view.lines.map((line, index) => (
            <li key={index}>{t("lineValue", { title: line.title, accepted: line.accepted, promised: line.promised })}</li>
          ))}
        </ul>
      ) : null}
      {view.milestones.length ? <p className="text-muted-foreground">{t("milestonesValue", { names: view.milestones.map((row) => row.name).join(", ") })}</p> : null}
      {view.updates.length ? (
        <ul className="flex flex-col gap-1">
          {view.updates.map((update, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <Badge variant={healthVariant(update.health)}>{tProjects(`health.${update.health as "on_track"}`)}</Badge>
              <span className="text-muted-foreground">{date(update.on)}</span>
              <span>{update.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {view.publishes.length ? (
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {view.publishes.map((row, index) => (
            <li key={index}>
              {date(row.publishedOn)} · {tWork.has(`channels.${row.platform}`) ? tWork(`channels.${row.platform as "facebook"}`) : row.platform} · {row.title}
              {row.url ? (
                <a href={row.url} target="_blank" rel="noreferrer" className="ml-1 underline">
                  {t("open")}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="reports" />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("list")}</h2>
        {reports.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
        {reports.map((report, index) => (
          <article key={report.id} className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{report.title}</h3>
              <span className="text-sm text-muted-foreground">
                {date(report.periodFrom)} – {date(report.periodTo)}
              </span>
              {report.showHours ? <Badge variant="outline">{t("withHours")}</Badge> : null}
              <a href={`/projects/${project.id}/reports/${report.id}/pdf`} className="ml-auto text-sm underline">
                {t("pdf")}
              </a>
            </div>
            {report.summary ? <p className="text-sm whitespace-pre-line">{report.summary}</p> : null}
            {summary(figures[index])}
            {report.nextPlan ? (
              <div className="text-sm">
                <p className="text-xs text-muted-foreground">{t("fields.nextPlan")}</p>
                <p className="whitespace-pre-line">{report.nextPlan}</p>
              </div>
            ) : null}
            {write ? (
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">{t("edit")}</summary>
                <div className="pt-2">
                  <ClientReportForm projectId={project.id} report={{ id: report.id, title: report.title, periodFrom: report.periodFrom, periodTo: report.periodTo, summary: report.summary, nextPlan: report.nextPlan, showHours: report.showHours }} defaults={{ title: report.title, from: report.periodFrom, to: report.periodTo }} />
                </div>
              </details>
            ) : null}
          </article>
        ))}
      </section>

      {write ? (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
          <h2 className="text-base font-medium">{t("new")}</h2>
          <p className="text-xs text-muted-foreground">{t("newHint")}</p>
          <ClientReportForm projectId={project.id} defaults={{ title: t("defaultTitle", { project: project.name, month: period.from.slice(0, 7) }), from: period.from, to: period.to }} />
        </section>
      ) : null}
    </div>
  );
}
