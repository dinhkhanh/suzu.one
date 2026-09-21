import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { clashesFor, getInterviewView, interviewerOptions, scorecardsFor } from "@/modules/recruit/interviews";
import { CvLink } from "@/modules/recruit/ui/cv-link";
import { RescheduleInterview } from "@/modules/recruit/ui/interview-form";
import { InterviewStatusActions } from "@/modules/recruit/ui/interview-status";
import { ScorecardForm, ScorecardPanel } from "@/modules/recruit/ui/scorecard-form";
import { TIME_ZONE } from "@/i18n/config";

export const metadata: Metadata = { title: "Interview" };

/** The wall-clock date and time in the office's zone, for the reschedule form's inputs. */
function officeParts(at: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/**
 * One interview. Two audiences meet on this page and see different halves of it: the recruiter or
 * hiring manager, who may move it and read the panel, and the interviewer, who may be neither and
 * whose whole access to this candidate is this page. The blind rule decides what the panel shows —
 * it is applied in `scorecardsFor`, never here.
 */
export default async function InterviewPage({ params }: PageProps<"/recruit/interviews/[interviewId]">) {
  const { interviewId } = await params;
  const user = await requireUser();
  const viewer = { principal: user.principal, personId: user.person.id };
  const view = await getInterviewView(viewer, interviewId);
  if (!view) notFound();

  const t = await getTranslations("recruit.interview");
  const tRecruit = await getTranslations("recruit");
  const format = await getFormatter();
  const cards = await scorecardsFor(viewer, interviewId);
  const { interview } = view;

  const [options, clashes] = view.canSchedule
    ? await Promise.all([interviewerOptions(view.openingId), clashesFor(view.interviewers.map((row) => row.personId), { from: interview.startAt, to: interview.endAt }, interview.id)])
    : [[], []];
  const parts = officeParts(interview.startAt);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1>{interview.title}</h1>
          <p className="text-sm text-muted-foreground">
            {view.candidateName} ·{" "}
            {view.canSchedule ? (
              <Link href={`/recruit/applications/${view.applicationId}`} className="underline underline-offset-4">
                {view.openingTitle}
              </Link>
            ) : (
              view.openingTitle
            )}
          </p>
        </div>
        <Badge variant={interview.status === "scheduled" ? "default" : "outline"}>{t(`statuses.${interview.status}`)}</Badge>
      </header>

      <dl className="grid gap-2 rounded-xl border p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("when")}</dt>
          <dd>{format.dateTime(interview.startAt, { dateStyle: "full", timeStyle: "short" })}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("duration")}</dt>
          <dd>{t("minutes", { count: Math.round((interview.endAt.getTime() - interview.startAt.getTime()) / 60_000) })}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("mode")}</dt>
          <dd>{t(`modes.${interview.mode}`)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("kind")}</dt>
          <dd>{t(`kinds.${interview.kind}`)}</dd>
        </div>
        {interview.location ? (
          <div className="flex justify-between gap-3 sm:col-span-2">
            <dt className="text-muted-foreground">{t("location")}</dt>
            <dd>{interview.location}</dd>
          </div>
        ) : null}
        {interview.meetingUrl ? (
          <div className="flex justify-between gap-3 sm:col-span-2">
            <dt className="text-muted-foreground">{t("meetingUrl")}</dt>
            <dd>
              <a href={interview.meetingUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                {interview.meetingUrl}
              </a>
            </dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 sm:col-span-2">
          <dt className="text-muted-foreground">{t("interviewers")}</dt>
          <dd>{view.interviewers.map((row) => row.fullName).join(", ")}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        {/* The part that needs no integration at all: a file every calendar reads. */}
        <a href={`/recruit/interviews/${interviewId}/ics`} className={buttonVariants({ size: "sm", variant: "outline" })}>
          {t("downloadIcs")}
        </a>
        {/* Honest about what the adapter managed. With no service account this always says "local". */}
        <span className="text-xs text-muted-foreground">
          {t(`calendar.${interview.calendarStatus ?? "simulated"}` as "calendar.simulated")}
          {interview.calendarError ? ` · ${interview.calendarError.slice(0, 120)}` : ""}
        </span>
      </div>

      {interview.notesForCandidate ? <p className="whitespace-pre-line rounded-xl border p-4 text-sm text-muted-foreground">{interview.notesForCandidate}</p> : null}

      {/* An interviewer reads the CV before the conversation; the warning travels with the control. */}
      {view.cvFileId ? (
        <section className="flex flex-col gap-1 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{tRecruit("columns.cv")}</h2>
          <CvLink applicationId={view.applicationId} fileId={view.cvFileId} fileName={tRecruit("columns.cv")} />
          <p className="text-xs text-muted-foreground">{tRecruit("notScanned")}</p>
        </section>
      ) : null}

      {cards ? <ScorecardForm interviewId={interviewId} criteria={cards.criteria} mine={cards.mine ? { ...cards.mine, submitted: !!cards.mine.submittedAt } : null} canScore={cards.canScore} /> : null}
      {cards ? <ScorecardPanel criteria={cards.criteria} others={cards.others} blind={cards.blind} awaiting={cards.awaiting} /> : null}

      {view.canSchedule ? (
        <>
          {clashes.length > 0 ? (
            <p className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">{t("clash", { names: clashes.map((row) => row.fullName).join(", ") })}</p>
          ) : null}
          <InterviewStatusActions interviewId={interviewId} status={interview.status} />
          {interview.status === "scheduled" ? (
            <RescheduleInterview
              interviewId={interviewId}
              options={options}
              current={{
                ...parts,
                minutes: Math.round((interview.endAt.getTime() - interview.startAt.getTime()) / 60_000),
                location: interview.location,
                meetingUrl: interview.meetingUrl,
                interviewerPersonIds: view.interviewers.map((row) => row.personId),
              }}
            />
          ) : null}
        </>
      ) : null}

      <p className="text-xs text-muted-foreground">{tRecruit("confidential")}</p>
    </div>
  );
}
