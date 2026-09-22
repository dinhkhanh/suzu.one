import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { headers } from "next/headers";
import { requireUser } from "@/modules/platform/auth/session";
import { listAssignments } from "@/modules/recruit/assignments";
import { listOffersOfApplication } from "@/modules/recruit/offers";
import { canMakeOffer } from "@/modules/recruit/policy";
import { APPLICATION_CLOSED, getApplicationView } from "@/modules/recruit/service";
import { CancelAssignment, RateAssignment, SendAssignment } from "@/modules/recruit/ui/assignment-forms";
import { AssignmentLink } from "@/modules/recruit/ui/assignment-link";
import { interviewerOptions, listInterviewsOfApplication } from "@/modules/recruit/interviews";
import { ApplicationActions } from "@/modules/recruit/ui/application-actions";
import { CvLink } from "@/modules/recruit/ui/cv-link";
import { listEmailTemplates } from "@/modules/recruit/emails";
import { ScheduleInterview } from "@/modules/recruit/ui/interview-form";
import { SendCandidateEmail } from "@/modules/recruit/ui/send-email";

export const metadata: Metadata = { title: "Application" };

// One application: who it is, where they are in the pipeline, and everything that has happened.
// The salary expectation is cut by tier in the service, so a recruiter's page simply lacks the row.
export default async function ApplicationPage({ params }: PageProps<"/recruit/applications/[applicationId]">) {
  const { applicationId } = await params;
  const user = await requireUser();
  const view = await getApplicationView({ principal: user.principal, personId: user.person.id }, applicationId);
  if (!view) notFound();

  const closed = APPLICATION_CLOSED.includes(view.application.status);
  // The offers on this application, and whether this reader may draft another one.
  const mayOffer = canMakeOffer(user.principal, { entityId: view.opening.entityId, departmentId: view.opening.departmentId, teamId: view.opening.teamId });
  // The caller has already been checked by `getApplicationView`; the panels are the same audience.
  // The take-home link is absolute so a recruiter can paste it straight into an email. Read from
  // the request, not from configuration: on a laptop it is localhost, in production it is the
  // deployment's own host, and neither should be guessed.
  const [t, tInterview, format, tAssignment, tOffer, offers, interviews, assignments, options, emailTemplates, requestHeaders] = await Promise.all([
    getTranslations("recruit"),
    getTranslations("recruit.interview"),
    getFormatter(),
    getTranslations("recruit.assignment"),
    getTranslations("recruit.offer"),
    listOffersOfApplication(applicationId),
    listInterviewsOfApplication(applicationId),
    listAssignments(applicationId),
    view.canAct ? interviewerOptions(view.opening.id) : [],
    view.canAct ? listEmailTemplates() : [],
    headers(),
  ]);
  const origin = `${requestHeaders.get("x-forwarded-proto") ?? "http"}://${requestHeaders.get("host") ?? ""}`;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{view.candidate.fullName}</h1>
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

      {/* Interviews (FR-REC-06). The list is everybody's; booking one is the hiring team's. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{tInterview("heading")}</h2>
        {interviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tInterview("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {interviews.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/recruit/interviews/${row.id}`} className="text-sm font-medium hover:underline">
                    {row.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{row.interviewers.map((person) => person.fullName).join(", ")}</p>
                </div>
                <span className="text-xs text-muted-foreground">{format.dateTime(row.startAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                <Badge variant={row.status === "scheduled" ? "default" : "outline"}>{tInterview(`statuses.${row.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
        {view.canAct && !closed ? <ScheduleInterview applicationId={applicationId} stages={view.stages} options={options} /> : null}
      </section>

      {/* Take-home assignments (FR-REC-07). The brief goes out as a link; the work comes back
          through the public page, and the file is `not_scanned` like every other candidate upload. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{tAssignment("heading")}</h2>
        {assignments.length === 0 ? <p className="text-sm text-muted-foreground">{tAssignment("none")}</p> : null}
        {assignments.map((assignment) => (
          <article key={assignment.id} className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{assignment.title}</span>
              <Badge variant={assignment.status === "sent" ? "secondary" : "outline"}>{tAssignment(`statuses.${assignment.status}`)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {tAssignment("due")}: {format.dateTime(assignment.dueAt, { dateStyle: "medium", timeStyle: "short" })}
              {assignment.submittedAt ? ` · ${tAssignment("submittedAt")}: ${format.dateTime(assignment.submittedAt, { dateStyle: "medium", timeStyle: "short" })}` : ""}
            </p>
            {assignment.submissionNote ? <p className="whitespace-pre-line text-muted-foreground">{assignment.submissionNote}</p> : null}
            {assignment.submissionLinks.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {assignment.submissionLinks.map((link) => (
                  <li key={link}>
                    <a href={link} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {assignment.submissionFileId ? (
              <div className="flex flex-col gap-1">
                <AssignmentLink assignmentId={assignment.id} fileId={assignment.submissionFileId} fileName={assignment.title} />
                <p className="text-xs text-muted-foreground">{t("notScanned")}</p>
              </div>
            ) : null}
            {view.canAct && assignment.submittedAt && assignment.status !== "cancelled" ? <RateAssignment assignmentId={assignment.id} rating={assignment.rating} /> : null}
            {view.canAct && assignment.status === "sent" ? <CancelAssignment assignmentId={assignment.id} /> : null}
          </article>
        ))}
        {view.canAct && !closed ? <SendAssignment applicationId={applicationId} origin={origin} /> : null}
      </section>

      {/* Offers (FR-REC-08). The list is the hiring team's; drafting one is the money authority's,
          so the "make an offer" link is only drawn for a reader who may type a figure. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{tOffer("heading")}</h2>
        {offers.length === 0 ? <p className="text-sm text-muted-foreground">{tOffer("none")}</p> : null}
        {offers.length > 0 ? (
          <ul className="flex flex-col divide-y rounded-xl border">
            {offers.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
                <Link href={`/recruit/offers/${row.id}`} className="min-w-0 flex-1 text-sm font-medium hover:underline">
                  {row.number}
                </Link>
                <span className="text-xs text-muted-foreground">{format.dateTime(new Date(`${row.startDate}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}</span>
                <Badge variant={row.status === "accepted" ? "default" : "outline"}>{tOffer(`statuses.${row.status}`)}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
        {mayOffer && !closed ? (
          <div>
            <Link href={`/recruit/offers/new?applicationId=${applicationId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
              {tOffer("create")}
            </Link>
          </div>
        ) : null}
      </section>

      {view.canAct ? <ApplicationActions applicationId={applicationId} stages={view.stages} currentStageId={view.stage.id} closed={closed} /> : null}

      {view.canAct ? (
        <SendCandidateEmail
          applicationId={applicationId}
          templates={emailTemplates.map((template) => ({ id: template.id, name: template.name, kind: template.kind }))}
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
