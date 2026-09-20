import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { APPLICATION_CLOSED, getApplicationView } from "@/modules/recruit/service";
import { ApplicationActions } from "@/modules/recruit/ui/application-actions";
import { CvLink } from "@/modules/recruit/ui/cv-link";
import { listEmailTemplates } from "@/modules/recruit/emails";
import { SendCandidateEmail } from "@/modules/recruit/ui/send-email";

export const metadata: Metadata = { title: "Application" };

// One application: who it is, where they are in the pipeline, and everything that has happened.
// The salary expectation is cut by tier in the service, so a recruiter's page simply lacks the row.
export default async function ApplicationPage({ params }: PageProps<"/recruit/applications/[applicationId]">) {
  const { applicationId } = await params;
  const user = await requireUser();
  const view = await getApplicationView({ principal: user.principal, personId: user.person.id }, applicationId);
  if (!view) notFound();

  const t = await getTranslations("recruit");
  const format = await getFormatter();
  const closed = APPLICATION_CLOSED.includes(view.application.status);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{view.candidate.fullName}</h1>
          <p className="text-sm text-muted-foreground">
            <Link href={`/recruit/${view.opening.id}`} className="underline underline-offset-4">
              {view.opening.title}
            </Link>
            {` · ${view.opening.code}`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant={view.application.status === "active" ? "default" : "outline"}>{t(`applicationStatus.${view.application.status}`)}</Badge>
          <span className="text-xs text-muted-foreground">{view.stage.name}</span>
        </div>
      </header>

      <dl className="grid gap-2 rounded-xl border p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("columns.appliedAt")}</dt>
          <dd>{format.dateTime(view.application.appliedAt, { dateStyle: "medium" })}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("columns.source")}</dt>
          <dd>{t(`source.${view.application.source}`)}</dd>
        </div>
        {/* Only drawn for a compensation-tier grant over this opening. */}
        {view.canReadMoney ? (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("form.salaryExpectation")}</dt>
            <dd>{view.salaryExpectationVnd === null ? "—" : format.number(view.salaryExpectationVnd)}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("columns.candidate")}</dt>
          <dd>
            <Link href={`/recruit/candidates/${view.candidate.id}`} className="underline underline-offset-4">
              {t("actions.openCandidate")}
            </Link>
          </dd>
        </div>
      </dl>

      {/* The CV came from the internet and nothing has scanned it. The warning is part of the
          control, not a footnote somewhere else on the page. */}
      {view.application.cvFileId && view.cvFileName ? (
        <section className="flex flex-col gap-1 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("columns.cv")}</h2>
          <CvLink applicationId={applicationId} fileId={view.application.cvFileId} fileName={view.cvFileName} />
          <p className="text-xs text-muted-foreground">{t("notScanned")}</p>
        </section>
      ) : null}

      {Object.keys(view.application.answers).length > 0 ? (
        <dl className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
          {view.opening.questions
            .filter((question) => view.application.answers[question.key])
            .map((question) => (
              <div key={question.key} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{question.label}</dt>
                <dd className="whitespace-pre-line">{view.application.answers[question.key]}</dd>
              </div>
            ))}
        </dl>
      ) : null}

      {view.application.coverLetter ? <p className="whitespace-pre-line rounded-xl border p-4 text-sm text-muted-foreground">{view.application.coverLetter}</p> : null}

      {view.application.portfolioLinks.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {view.application.portfolioLinks.map((link) => (
            <li key={link}>
              <a href={link} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                {link}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {view.canAct ? <ApplicationActions applicationId={applicationId} stages={view.stages} currentStageId={view.stage.id} closed={closed} /> : null}

      {view.canAct ? (
        <SendCandidateEmail
          applicationId={applicationId}
          templates={(await listEmailTemplates()).map((template) => ({ id: template.id, name: template.name, kind: template.kind }))}
          hasEmail={!!view.candidate.email}
        />
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("history")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border text-sm">
          {view.events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="min-w-0 flex-1">
                {t(`event.${event.type}`)}
                {event.toStageName ? ` → ${event.toStageName}` : ""}
                {event.note ? <span className="block text-xs text-muted-foreground">{event.note}</span> : null}
              </span>
              <span className="text-xs text-muted-foreground">{event.actorName ?? t("source.careers_page")}</span>
              <span className="text-xs text-muted-foreground">{format.dateTime(event.at, { dateStyle: "medium", timeStyle: "short" })}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">{t("confidential")}</p>
    </div>
  );
}
