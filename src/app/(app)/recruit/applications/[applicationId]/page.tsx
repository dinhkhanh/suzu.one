import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";
import { publicOrigin } from "@/lib/site";
import { requireUser } from "@/modules/platform/auth/session";
import { listAssignments } from "@/modules/recruit/assignments";
import { listOffersOfApplication } from "@/modules/recruit/offers";
import { canMakeOffer } from "@/modules/recruit/policy";
import { APPLICATION_CLOSED, type ApplicationEventView, getApplicationView } from "@/modules/recruit/service";
import { CancelAssignment, RateAssignment, SendAssignment } from "@/modules/recruit/ui/assignment-forms";
import { AssignmentLink } from "@/modules/recruit/ui/assignment-link";
import { interviewerOptions, listInterviewsOfApplication } from "@/modules/recruit/interviews";
import { ApplicationActions } from "@/modules/recruit/ui/application-actions";
import { CvLink } from "@/modules/recruit/ui/cv-link";
import { listHandSentTemplates } from "@/modules/recruit/emails";
import { ScheduleInterview } from "@/modules/recruit/ui/interview-form";
import { SendCandidateEmail } from "@/modules/recruit/ui/send-email";
import { pageTitle } from "@/i18n/page-title";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

export const generateMetadata = pageTitle("application");

/** The outcome of one letter, as a tint and a line: the recruiter's only window onto the outbox. */
async function LetterDelivery({ event }: { event: ApplicationEventView }) {
  const t = await getTranslations("recruit");
  const skipped = typeof event.detail?.skipped === "string" ? event.detail.skipped : null;
  if (skipped) {
    return (
      <span className="mt-1 flex">
        <Badge variant="warning">{t(`letterStatus.${skipped}` as "letterStatus.no_address")}</Badge>
      </span>
    );
  }
  if (!event.delivery) return null;
  const { status, error } = event.delivery;
  // Pending with an error is a send that failed and will be tried again; pending without one has not been tried yet.
  const state = status === "pending" ? (error ? "retrying" : "pending") : status;
  const tone = state === "sent" ? "success" : state === "failed" ? "destructive" : state === "retrying" || state === "skipped" ? "warning" : "secondary";
  return (
    <span className="mt-1 flex flex-col items-start gap-0.5">
      <Badge dot variant={tone}>
        {t(`delivery.${state}`)}
      </Badge>
      {error && state !== "sent" ? <span className="text-xs break-all text-destructive">{error}</span> : null}
    </span>
  );
}

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
  const [t, tInterview, format, tAssignment, tOffer, offers, interviews, assignments, options, emailTemplates] = await Promise.all([
    getTranslations("recruit"),
    getTranslations("recruit.interview"),
    getFormatter(),
    getTranslations("recruit.assignment"),
    getTranslations("recruit.offer"),
    listOffersOfApplication(applicationId),
    listInterviewsOfApplication(applicationId),
    listAssignments(applicationId),
    view.canAct ? interviewerOptions(view.opening.id) : [],
    // Not the interview's own letters: those go out from the interview, with its time filled in.
    view.canAct ? listHandSentTemplates() : [],
  ]);
  // The take-home link is absolute so a recruiter can paste it straight into an email, and names
  // the public domain when there is one (PUBLIC_SITE_URL), whichever domain the recruiter is on.
  const origin = publicOrigin();

  return (
    <Page>
      <PageHeader
        eyebrow={
          <>
            <RecordLink kind="opening" id={view.opening.id}>
              {view.opening.title}
            </RecordLink>
            <span className="font-mono text-xs text-faint"> · {view.opening.code}</span>
          </>
        }
        title={view.candidate.fullName}
        actions={
          <Link href={`/recruit/candidates/${view.candidate.id}`} className={buttonVariants({ variant: "outline" })}>
            {t("actions.openCandidate")}
          </Link>
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge dot variant={statusTone(view.application.status)}>
            {closed ? t(`applicationStatus.${view.application.status}`) : view.stage.name}
          </Badge>
          {closed ? <Badge variant="outline">{view.stage.name}</Badge> : null}
          <Badge variant="outline">{t(`source.${view.application.source}`)}</Badge>
        </div>
      </PageHeader>

      <TableCard>
        <Table numbered={false}>
          <TableBody>
            <TableRow>
              <TableCell className="w-40 whitespace-normal text-muted-foreground">{t("columns.appliedAt")}</TableCell>
              <TableCell className="whitespace-normal">{format.dateTime(view.application.appliedAt, { dateStyle: "medium" })}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="w-40 whitespace-normal text-muted-foreground">{t("columns.stage")}</TableCell>
              <TableCell className="whitespace-normal">{view.stage.name}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="w-40 whitespace-normal text-muted-foreground">{t("columns.source")}</TableCell>
              <TableCell className="whitespace-normal">{t(`source.${view.application.source}`)}</TableCell>
            </TableRow>
            {/* Only drawn for a compensation-tier grant over this opening. */}
            {view.canReadMoney ? (
              <TableRow>
                <TableCell className="w-40 whitespace-normal text-muted-foreground">{t("form.salaryExpectation")}</TableCell>
                <TableCell kind="money" className="text-left">
                  {view.salaryExpectationVnd === null ? "—" : format.number(view.salaryExpectationVnd)}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableCard>

      {/* The CV came from the internet and nothing has scanned it. The warning is part of the
          control, not a footnote somewhere else on the page. */}
      {view.application.cvFileId && view.cvFileName ? (
        <section className="flex flex-col gap-1 rounded-[14px] border border-border bg-background p-4">
          <h2 className="text-sm font-medium">{t("columns.cv")}</h2>
          <CvLink applicationId={applicationId} fileId={view.application.cvFileId} fileName={view.cvFileName} />
          <p className="text-xs text-muted-foreground">{t("notScanned")}</p>
        </section>
      ) : null}

      {Object.keys(view.application.answers).length > 0 ? (
        <dl className="flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4 text-sm">
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

      <RichText text={view.application.coverLetter} className="rounded-[14px] border border-border bg-background p-4 text-sm text-muted-foreground" />

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
        <TableCard>
          <TableCardHeader title={tInterview("heading")} count={interviews.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{tInterview("title")}</TableHead>
                <TableHead kind="person">{tInterview("interviewers")}</TableHead>
                <TableHead kind="date">{tInterview("when")}</TableHead>
                <TableHead kind="status">{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {interviews.length === 0 ? <TableEmpty>{tInterview("none")}</TableEmpty> : null}
              {interviews.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-72 truncate">
                    <RecordLink kind="interview" id={row.id} className="font-medium">
                      {row.title}
                    </RecordLink>
                  </TableCell>
                  <TableCell className="max-w-64 truncate">
                    {row.interviewers.length === 0 ? "—" : null}
                    {row.interviewers.map((person, index) => (
                      <Fragment key={person.personId}>
                        {index ? ", " : ""}
                        <RecordLink kind="person" id={person.personId}>
                          {person.fullName}
                        </RecordLink>
                      </Fragment>
                    ))}
                  </TableCell>
                  <TableCell>{format.dateTime(row.startAt, { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(row.status)}>
                      {tInterview(`statuses.${row.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
        {view.canAct && !closed ? <ScheduleInterview applicationId={applicationId} stages={view.stages} options={options} /> : null}
      </section>

      {/* Take-home assignments (FR-REC-07). The brief goes out as a link; the work comes back
          through the public page, and the file is `not_scanned` like every other candidate upload. */}
      <section className="flex flex-col gap-3">
        <TableCard>
          <TableCardHeader title={tAssignment("heading")} count={assignments.length || null} />
          <List>
            {assignments.length === 0 ? <ListEmpty>{tAssignment("none")}</ListEmpty> : null}
            {assignments.map((assignment) => (
              <ListItem key={assignment.id} className="flex-col items-stretch gap-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{assignment.title}</span>
                  <Badge dot variant={statusTone(assignment.status)}>
                    {tAssignment(`statuses.${assignment.status}`)}
                  </Badge>
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
              </ListItem>
            ))}
          </List>
        </TableCard>
        {view.canAct && !closed ? <SendAssignment applicationId={applicationId} origin={origin} /> : null}
      </section>

      {/* Offers (FR-REC-08). The list is the hiring team's; drafting one is the money authority's,
          so the "make an offer" link is only drawn for a reader who may type a figure. */}
      <TableCard>
        <TableCardHeader title={tOffer("heading")} count={offers.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{tOffer("heading")}</TableHead>
              <TableHead kind="date">{tOffer("startDate")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.length === 0 ? <TableEmpty>{tOffer("none")}</TableEmpty> : null}
            {offers.map((row) => (
              <TableRow key={row.id}>
                <TableCell kind="id">
                  <RecordLink kind="offer" id={row.id} className="font-medium text-foreground">
                    {row.number}
                  </RecordLink>
                </TableCell>
                <TableCell>{format.dateTime(new Date(`${row.startDate}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.status)}>
                    {tOffer(`statuses.${row.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {mayOffer && !closed ? <TableAddRow label={tOffer("create")} href={`/recruit/offers/new?applicationId=${applicationId}`} /> : null}
      </TableCard>

      {view.canAct ? <ApplicationActions applicationId={applicationId} stages={view.stages} currentStageId={view.stage.id} closed={closed} /> : null}

      {view.canAct ? (
        <SendCandidateEmail
          applicationId={applicationId}
          templates={emailTemplates.map((template) => ({ id: template.id, name: template.name, kind: template.kind }))}
          hasEmail={!!view.candidate.email}
          defaultLocale={view.candidate.locale ?? "vi"}
        />
      ) : null}

      <Section title={t("history")} count={view.events.length || null}>
        <List>
          {view.events.map((event) => (
            <ListItem key={event.id} className="items-start">
              <span className="w-28 shrink-0 pt-0.5 font-mono text-xs text-faint tabular-nums">{format.dateTime(event.at, { dateStyle: "short", timeStyle: "short" })}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {/* Emptied because the window lapsed, or because the candidate asked: two different facts. */}
                  {event.type === "anonymised" && event.detail?.reason === "erasure" ? t("event.erased") : t(`event.${event.type}`)}
                  {event.toStageName ? ` → ${event.toStageName}` : ""}
                </span>
                <span className="block text-xs text-faint">
                  {event.actorName ? (
                    <RecordLink kind="person" id={event.actorPersonId}>
                      {event.actorName}
                    </RecordLink>
                  ) : (
                    t("source.careers_page")
                  )}
                </span>
                {event.note ? <span className="block text-xs text-muted-foreground">{noteToPlainText(event.note)}</span> : null}
                {/* A letter to the candidate: whether it went, is being retried, or failed — and a
                    letter that could not be sent at all says why. */}
                {event.type === "emailed" ? <LetterDelivery event={event} /> : null}
              </span>
            </ListItem>
          ))}
        </List>
      </Section>

      <p className="text-xs text-faint">{t("confidential")}</p>
    </Page>
  );
}
