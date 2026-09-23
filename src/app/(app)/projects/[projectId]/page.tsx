import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { RequestHistory, RequestStatusBadge, RequestTools } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { decideBriefAction } from "@/modules/projects/actions";
import { awaitingAcceptance, briefEditable, briefProblems, briefSubmittable, type BriefStatus, getBriefRequest, listStatusUpdates, openBriefForApprover, openProject, PROJECT_KINDS, type ProjectKind } from "@/modules/projects/service";
import { AcceptanceWaitingList } from "@/modules/projects/ui/acceptance-waiting";
import { BriefView } from "@/modules/projects/ui/brief-view";
import { AccountManagerForm, BriefForm, PlanSettingsForm, SubmitBriefButton } from "@/modules/projects/ui/plan-forms";
import { healthVariant, ProjectHeader } from "@/modules/projects/ui/project-header";
import { listProjectMembers } from "@/modules/work/service";

export const metadata: Metadata = { title: "Project" };

/**
 * A project's overview: the brief and its kick-off gate (FR-PJM-03), the project's roles and
 * settings (FR-PJM-01, 14) and its health history (FR-PJM-27). An approver of the kick-off who may
 * not open the project (the owners, for a private project with no other lead) sees the brief and
 * the request only.
 */
export default async function ProjectOverviewPage({ params }: PageProps<"/projects/[projectId]">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  const t = await getTranslations("projects");
  const format = await getFormatter();

  if (!context) {
    const approver = await openBriefForApprover(user, projectId);
    if (!approver) notFound();
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2">
            {approver.plan.jobNumber ? <span className="font-mono text-base text-muted-foreground">{approver.plan.jobNumber}</span> : null}
            {approver.projectName}
          </h1>
          <p className="text-sm text-muted-foreground">{t("kickoff.approverOnly")}</p>
        </header>
        <BriefView brief={approver.plan.brief} />
        {approver.request.canDecide ? <DecisionForm requestId={approver.request.request.id} action={decideBriefAction} /> : null}
        <RequestTools view={approver.request} viewerPersonId={user.person.id} />
        <RequestHistory view={approver.request} />
      </div>
    );
  }

  const { project, plan, can } = context;
  const [request, updates, members, people, waiting] = await Promise.all([getBriefRequest({ personId: user.person.id, principal: user.principal }, plan), listStatusUpdates(project.id, 10), listProjectMembers(project.id), can.editPlan ? listPersonNames() : Promise.resolve([]), awaitingAcceptance(project.id)]);
  const status = plan.briefStatus as BriefStatus;
  const editable = can.editClientSide && briefEditable(status);
  const problems = briefProblems(plan.brief, plan.kind as ProjectKind);
  const lastComment = request?.events.findLast((event) => event.type === "returned" || event.type === "rejected")?.comment ?? null;
  const accountManager = members.find((member) => member.role === "account_manager");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <ProjectHeader context={context} current="overview" />

      <section className="flex flex-col gap-4 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medium">{t("kickoff.title")}</h2>
          <div className="flex items-center gap-2">
            {request ? <RequestStatusBadge status={request.request.status} /> : null}
            <Badge variant={status === "approved" ? "success" : status === "returned" ? "warning" : "secondary"}>{t(`brief.status.${status}`)}</Badge>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{status === "approved" ? t("kickoff.approvedNote", { date: plan.briefApprovedAt ? format.dateTime(plan.briefApprovedAt, { dateStyle: "medium" }) : "—" }) : project.status === "planned" ? t("kickoff.gateNote") : t("kickoff.notApprovedNote")}</p>
        {status === "returned" && lastComment ? (
          <p role="status" className="rounded-md border border-amber-600/30 bg-amber-500/10 p-3 text-sm">
            {t("kickoff.returnedWith", { comment: lastComment })}
          </p>
        ) : null}

        {editable ? <BriefForm projectId={project.id} brief={plan.brief} kind={plan.kind} /> : <BriefView brief={plan.brief} />}

        {editable && briefSubmittable(status) ? (
          <div className="flex flex-col gap-2 border-t pt-3">
            {problems.length ? <p className="text-sm text-muted-foreground">{t("kickoff.missing", { fields: problems.map((field) => t(`brief.fields.${field}`)).join(", ") })}</p> : <p className="text-sm text-muted-foreground">{t("kickoff.ready")}</p>}
            <div>
              <SubmitBriefButton projectId={project.id} resubmit={status === "returned" && !!plan.briefApprovalRequestId} />
            </div>
          </div>
        ) : null}

        {request?.canDecide ? <DecisionForm requestId={request.request.id} action={decideBriefAction} /> : null}
        {request ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">{t("kickoff.history")}</summary>
            <div className="flex flex-col gap-4 pt-3">
              <RequestTools view={request} viewerPersonId={user.person.id} />
              <RequestHistory view={request} />
            </div>
          </details>
        ) : null}
      </section>

      <AcceptanceWaitingList projectId={project.id} waiting={waiting} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-medium">{t("updates.history")}</h2>
          <Link href={`/projects/${project.id}/updates`} className="text-sm underline">
            {t("updates.all")}
          </Link>
        </div>
        {updates.length === 0 ? <p className="text-sm text-muted-foreground">{t("updates.none")}</p> : null}
        <ol className="flex flex-col gap-2">
          {updates.map((update) => (
            <li key={update.id} className="flex flex-wrap items-start gap-2 text-sm">
              <Badge variant={healthVariant(update.health)}>{t(`health.${update.health as "on_track"}`)}</Badge>
              <span className="text-muted-foreground">{format.dateTime(update.createdAt, { dateStyle: "medium" })}</span>
              <span className="min-w-0 flex-1">{update.summary}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("settings.title")}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.lead")}</dt>
            <dd>{members.filter((member) => member.role === "lead").map((member) => member.fullName).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.accountManager")}</dt>
            <dd>{accountManager?.fullName ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.driveUrl")}</dt>
            <dd className="truncate">
              {plan.driveUrl ? (
                <a href={plan.driveUrl} target="_blank" rel="noreferrer" className="underline">
                  {plan.driveUrl}
                </a>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        {can.editPlan ? (
          <div className="flex flex-col gap-4 rounded-xl border p-4">
            <AccountManagerForm projectId={project.id} current={accountManager?.personId ?? null} people={people} />
            <PlanSettingsForm projectId={project.id} values={{ kind: plan.kind, budgetMinutes: plan.budgetMinutes, budgetByRole: plan.budgetByRole, updateCadenceDays: plan.updateCadenceDays, driveUrl: plan.driveUrl }} kinds={PROJECT_KINDS} />
          </div>
        ) : null}
      </section>
    </div>
  );
}
