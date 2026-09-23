import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { kbViewerOf, listSpaces } from "@/modules/kb/service";
import { requireUser } from "@/modules/platform/auth/session";
import { canCloseProject, canHoldRetro, type CloseReport, getCloseChecklist, getRetro, openProject, previewCloseReport, type StoredCloseReport } from "@/modules/projects/service";
import { CloseProjectForm, PublishLessonsForm, RetroForm } from "@/modules/projects/ui/commercial-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("closeProject");

/**
 * Close-out (FR-PJM-59): the checklist computed live, the retrospective and its lessons, and the
 * close itself — the lead's, with a reason when something is unmet. After the close, the final
 * report as it was kept, and the plan is read-only.
 */
export default async function ProjectClosePage({ params }: PageProps<"/projects/[projectId]/close">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, plan, viewer, facts } = context;
  const closed = !!plan.closedAt;
  const holdsRetro = canHoldRetro(viewer, facts);
  const [t, format, checklist, retro, preview, spaces] = await Promise.all([
    getTranslations("projects.close"),
    getFormatter(),
    closed ? Promise.resolve([]) : getCloseChecklist(project.id),
    getRetro(project.id),
    closed ? Promise.resolve(null) : previewCloseReport(project.id),
    holdsRetro ? listSpaces(kbViewerOf(user)) : Promise.resolve([]),
  ]);
  const stored = closed ? ((plan.closeReport as StoredCloseReport | null) ?? null) : null;
  const unmet = checklist.some((item) => !item.met);
  const today = todayInVietnam();
  const date = (value: string | null | undefined) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");
  const hours = (minutes: number | null | undefined) => (minutes === null || minutes === undefined ? "—" : format.number(minutes / 60, { maximumFractionDigits: 1 }));
  const writable = spaces.filter((space) => !space.archivedAt && (space.level === "edit" || space.level === "manage")).map(({ id, name }) => ({ id, name }));

  const reportView = (value: CloseReport) => (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-muted-foreground">{t("report.dates")}</dt>
        <dd>{t("report.datesValue", { baselineStart: date(value.dates.baselineStart), baselineDue: date(value.dates.baselineDue), actualStart: date(value.dates.actualStart), actualEnd: date(value.dates.actualEnd) })}</dd>
        {value.dates.slipDays !== null ? <dd className="text-muted-foreground">{t("report.slip", { days: value.dates.slipDays })}</dd> : null}
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("report.hours")}</dt>
        <dd>{t("report.hoursValue", { logged: hours(value.hours.loggedMinutes), budget: hours(value.hours.budgetMinutes), percent: value.hours.percent ?? "—" })}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("report.onTime")}</dt>
        <dd>{value.onTime.rate === null ? "—" : t("report.onTimeValue", { rate: value.onTime.rate, onTime: value.onTime.onTime, due: value.onTime.due })}</dd>
        <dd className="text-muted-foreground">{t("report.milestonesValue", { onTime: value.milestones.onTime, done: value.milestones.done, total: value.milestones.total })}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">{t("report.quality")}</dt>
        <dd>{value.revisionRounds ? t("report.roundsValue", { internal: value.revisionRounds.internal, client: value.revisionRounds.client }) : "—"}</dd>
        <dd className="text-muted-foreground">{value.returnedHandoffs === null ? null : t("report.returnedValue", { count: value.returnedHandoffs })}</dd>
      </div>
    </dl>
  );

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <ProjectHeader context={context} current="close" />

      {closed ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-base font-medium">{t("closedOn", { date: format.dateTime(plan.closedAt!, { dateStyle: "medium" }) })}</h2>
          <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
          {stored?.unmet?.length ? (
            <p className="text-sm">
              {t("closedWithUnmet", { items: stored.unmet.map((key) => t(`checks.${key as "tasks"}`)).join(", ") })} — {stored.overrideReason}
            </p>
          ) : null}
          {stored ? reportView(stored) : null}
        </section>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-xl border p-4">
            <h2 className="text-base font-medium">{t("checklist")}</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {checklist.map((item) => (
                <li key={item.key} className="flex flex-wrap items-center gap-2">
                  <Badge variant={item.met ? "success" : "warning"}>{item.met ? t("met") : t("unmet")}</Badge>
                  <span>{t(`checks.${item.key}`)}</span>
                  {!item.met && item.count ? <span className="text-muted-foreground">{t(`counts.${item.key as "tasks"}`, { count: item.count })}</span> : null}
                </li>
              ))}
            </ul>
          </section>
          {preview ? (
            <section className="flex flex-col gap-3 rounded-xl border p-4">
              <h2 className="text-base font-medium">{t("previewReport")}</h2>
              {reportView(preview)}
            </section>
          ) : null}
        </>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("retro.title")}</h2>
        {retro?.retro ? (
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            {(["wentWell", "improve", "actions"] as const).map((key) => (
              <div key={key} className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">{t(`retro.${key}`)}</p>
                <p className="whitespace-pre-line">{retro.retro?.[key] ?? "—"}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("retro.none")}</p>
        )}
        {holdsRetro ? (
          <details open={!retro}>
            <summary className="cursor-pointer text-sm text-muted-foreground">{retro ? t("retro.edit") : t("retro.hold")}</summary>
            <div className="pt-2">
              <RetroForm projectId={project.id} today={today} retro={retro ? { heldOn: retro.heldOn, ...(retro.retro ?? {}) } : null} />
            </div>
          </details>
        ) : null}
        {holdsRetro && retro?.retro ? (
          writable.length ? (
            <PublishLessonsForm projectId={project.id} spaces={writable} />
          ) : (
            <p className="text-xs text-muted-foreground">{t("noSpace")}</p>
          )
        ) : null}
      </section>

      {!closed && canCloseProject(viewer, facts) ? (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
          <h2 className="text-base font-medium">{t("closeTitle")}</h2>
          <CloseProjectForm projectId={project.id} unmet={unmet} />
        </section>
      ) : null}
    </div>
  );
}
