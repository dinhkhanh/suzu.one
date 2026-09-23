import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canEditMeeting, DEFAULT_MEETING_MINUTES, getMeeting, type MeetingKind, meetingPeople, openProject } from "@/modules/projects/service";
import { MeetingCalendar, MeetingForm } from "@/modules/projects/ui/collab-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("meeting");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One meeting (FR-PJM-30): who was there, the agenda and notes, the decisions it took and the tasks it gave. */
export default async function ProjectMeetingPage({ params }: PageProps<"/projects/[projectId]/meetings/[meetingId]">) {
  const user = await requireUser();
  const { projectId, meetingId } = await params;
  const context = await openProject(user, projectId);
  if (!context || !UUID.test(meetingId)) notFound();
  const { project, viewer, facts } = context;
  const meeting = await getMeeting(project.id, meetingId);
  if (!meeting) notFound();
  // The retrospective lives on the close-out page.
  if (meeting.kind === "retro") redirect(`/projects/${project.id}/close`);
  const edits = canEditMeeting(viewer, facts, meeting);
  const [t, tRaid, format, people] = await Promise.all([getTranslations("projects.meetings"), getTranslations("projects.raid"), getFormatter(), edits ? meetingPeople(project.id) : Promise.resolve([])]);
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <ProjectHeader context={context} current="meetings" />

      <section className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          <Link href={`/projects/${project.id}/meetings`} className="underline">
            {t("title")}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t(`kinds.${meeting.kind as MeetingKind}`)}</Badge>
          <h2 className="text-lg font-medium">{meeting.title}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{[date(meeting.heldOn), meeting.startTime ? t("atTime", { time: meeting.startTime.slice(0, 5), minutes: meeting.durationMinutes ?? DEFAULT_MEETING_MINUTES }) : null, meeting.authorName ? t("recordedBy", { name: meeting.authorName }) : null].filter(Boolean).join(" · ")}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.attendees")}</dt>
            <dd>{meeting.attendees.length ? meeting.attendees.map((person) => person.fullName).join(", ") : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.externalAttendees")}</dt>
            <dd>{meeting.externalAttendees ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.agenda")}</dt>
            <dd className="whitespace-pre-line">{meeting.agenda ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.notes")}</dt>
            <dd className="whitespace-pre-line">{meeting.notes ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">{t("fields.decisions")}</h2>
        {meeting.decisions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noDecisions")}</p> : null}
        <ul className="flex flex-col gap-2">
          {meeting.decisions.map((decision) => (
            <li key={decision.id} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{decision.title}</p>
              {decision.description ? <p className="whitespace-pre-line text-muted-foreground">{decision.description}</p> : null}
              <p className="text-xs text-muted-foreground">{[tRaid("decidedOnValue", { date: date(decision.decidedOn) }), tRaid(`statuses.${decision.status as "open"}`)].join(" · ")}</p>
            </li>
          ))}
        </ul>
        <Link href={`/projects/${project.id}/risks?kind=decision`} className="text-sm underline">
          {t("toLog")}
        </Link>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">{t("fields.actions")}</h2>
        {meeting.actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("noActions")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {meeting.actions.map((action) => (
            <li key={action.taskId}>
              <Link href={`/work/tasks/${action.taskId}`} className="flex flex-col gap-0.5 p-3 text-sm hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="mr-2 font-mono text-xs text-muted-foreground">{action.key}</span>
                  <span className={action.status === "done" || action.status === "cancelled" ? "line-through" : undefined}>{action.title}</span>
                </span>
                <span className="text-xs text-muted-foreground">{[action.assigneeName ?? t("unassigned"), action.dueDate ? date(action.dueDate) : null].filter(Boolean).join(" · ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {edits ? (
        <>
          {/* FR-PJM-30: the invitation, which says what the adapter really did — "simulated" included. */}
          <MeetingCalendar projectId={project.id} meeting={{ id: meeting.id, startTime: meeting.startTime, calendarEventId: meeting.calendarEventId, calendarStatus: meeting.calendarStatus, calendarError: meeting.calendarError, meetingUrl: meeting.meetingUrl }} />
          <section className="flex flex-col gap-3 rounded-xl border p-4">
            <h2 className="text-base font-medium">{t("edit")}</h2>
            <MeetingForm
              projectId={project.id}
              people={people}
              today={todayInVietnam()}
              meeting={{ id: meeting.id, kind: meeting.kind, title: meeting.title, heldOn: meeting.heldOn, startTime: meeting.startTime, durationMinutes: meeting.durationMinutes, attendeeIds: meeting.attendeeIds, externalAttendees: meeting.externalAttendees, agenda: meeting.agenda, notes: meeting.notes }}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
