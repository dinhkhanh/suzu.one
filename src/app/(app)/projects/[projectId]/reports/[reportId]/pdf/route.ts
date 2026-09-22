// A client report as a PDF (FR-PJM-58) on the entity's letterhead, on the documents module's
// writer. Node runtime, never cached, never stored; access re-checked now. The figures are the
// engine's (`reportFigures`): no fee, and internal hours only when the author chose to show them.
import { NextResponse } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import { renderDocumentPdf } from "@/modules/documents/document-pdf";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { clientReportFigures, entityLetterhead, findClientReport, openProject, reportText } from "@/modules/projects/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/projects/[projectId]/reports/[reportId]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { projectId, reportId } = await context.params;
  const project = await openProject(user, projectId);
  const report = project ? await findClientReport(reportId).catch(() => undefined) : undefined;
  if (!project || !report || report.projectId !== projectId) {
    await recordAudit({ action: "projects.client_report.pdf.denied", actor: { userId: user.userId, personId: user.person.id, email: user.email }, request: user.request, resource: { type: "project_client_report", id: reportId } });
    return new NextResponse("Not found", { status: 404 });
  }

  const [t, tProjects, tWork, tDocuments, format, figures, letterhead] = await Promise.all([
    getTranslations("projects.reports"),
    getTranslations("projects"),
    getTranslations("work"),
    getTranslations("documents"),
    getFormatter(),
    clientReportFigures(projectId, { from: report.periodFrom, to: report.periodTo }, { showHours: report.showHours }),
    entityLetterhead(projectId),
  ]);
  const number = format.number;
  const text = reportText(report, figures, {
    period: t("period"),
    summary: t("fields.summary"),
    register: t("register"),
    registerLine: (line) => t("lineValue", { title: line.title, accepted: line.accepted, promised: line.promised }),
    registerTotal: (register) => t("registerValue", { accepted: register.accepted, promised: register.promised }),
    publishing: t("publishing"),
    publishingTotal: (publishing) => t("publishingValue", { count: publishing.count, reach: number(publishing.totals.reach), views: number(publishing.totals.views), engagement: number(publishing.totals.engagement) }),
    milestones: t("milestones"),
    updates: t("updates"),
    hours: (hours) => t("hoursValue", { hours: format.number(hours.loggedMinutes / 60, { maximumFractionDigits: 1 }) }),
    nextPlan: t("fields.nextPlan"),
    none: "—",
    platform: (platform) => (tWork.has(`channels.${platform}`) ? tWork(`channels.${platform as "facebook"}`) : platform),
    health: (health) => (tProjects.has(`health.${health}`) ? tProjects(`health.${health as "on_track"}`) : health),
    date: (value) => value.split("-").reverse().join("/"),
  });
  const code = [project.plan.jobNumber, report.periodTo].filter(Boolean).join(" · ");
  const pdf = renderDocumentPdf({ title: report.title, number: code, text: `${project.project.name}\n\n${text}`, letterhead, footer: tDocuments("pdfFooter", { number: code }), today: todayInVietnam() });

  await recordAudit({ action: "projects.client_report.pdf", actor: { userId: user.userId, personId: user.person.id, email: user.email }, request: user.request, resource: { type: "project_client_report", id: report.id, entityId: project.project.entityId }, summary: `${report.periodFrom}–${report.periodTo}` });

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-${report.periodTo}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
