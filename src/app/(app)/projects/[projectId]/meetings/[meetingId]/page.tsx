import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Page } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canEditMeeting, DEFAULT_MEETING_MINUTES, getMeeting, type MeetingKind, meetingPeople, openProject } from "@/modules/projects/service";
import { MeetingCalendar, MeetingForm } from "@/modules/projects/ui/collab-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

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
  const [t, tRaid, tProjects, format, people] = await Promise.all([getTranslations("projects.meetings"), getTranslations("projects.raid"), getTranslations("projects"), getFormatter(), edits ? meetingPeople(project.id) : Promise.resolve([])]);
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");

  return (
    <Page>
      <ProjectHeader context={context} current="meetings" />

      <section className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          <Link href={`/projects/${project.id}/meetings`} className="underline">
            {t("title")}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t(`kinds.${meeting.kind as MeetingKind}`)}</Badge>
          <h2>{meeting.title}</h2>
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
            <dd>{meeting.agenda?.trim() ? <RichText text={meeting.agenda} /> : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t("fields.notes")}</dt>
            <dd>{meeting.notes?.trim() ? <RichText text={meeting.notes} /> : "—"}</dd>
          </div>
        </dl>
      </section>

      <TableCard>
        <TableCardHeader
          title={t("fields.decisions")}
          count={meeting.decisions.length || null}
          actions={
            <Link href={`/projects/${project.id}/risks?kind=decision`} className="text-sm underline">
              {t("toLog")}
            </Link>
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{tRaid("fields.title")}</TableHead>
              <TableHead kind="date">{tRaid("fields.decidedOn")}</TableHead>
              <TableHead kind="status">{tProjects("fields.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meeting.decisions.length === 0 ? <TableEmpty>{t("noDecisions")}</TableEmpty> : null}
            {meeting.decisions.map((decision) => (
              <TableRow key={decision.id}>
                <TableCell className="whitespace-normal">
                  <p className="font-medium">{decision.title}</p>
                  <RichText text={decision.description} className="text-muted-foreground" />
                </TableCell>
                <TableCell>{date(decision.decidedOn)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{tRaid(`statuses.${decision.status as "open"}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("fields.actions")} count={meeting.actions.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("fields.action")}</TableHead>
              <TableHead kind="person">{t("fields.assignee")}</TableHead>
              <TableHead kind="date">{t("fields.due")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meeting.actions.length === 0 ? <TableEmpty>{t("noActions")}</TableEmpty> : null}
            {meeting.actions.map((action) => (
              <TableRow key={action.taskId}>
                <TableCell className="max-w-96 truncate">
                  <Link href={`/work/tasks/${action.taskId}`} className="hover:underline">
                    <span className="mr-2 font-mono text-xs text-muted-foreground">{action.key}</span>
                    <span className={action.status === "done" || action.status === "cancelled" ? "line-through" : undefined}>{action.title}</span>
                  </Link>
                </TableCell>
                <TableCell>{action.assigneeName ?? t("unassigned")}</TableCell>
                <TableCell>{action.dueDate ? date(action.dueDate) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {edits ? (
        <>
          {/* FR-PJM-30: the invitation, which says what the adapter really did — "simulated" included. */}
          <MeetingCalendar projectId={project.id} meeting={{ id: meeting.id, startTime: meeting.startTime, calendarEventId: meeting.calendarEventId, calendarStatus: meeting.calendarStatus, calendarError: meeting.calendarError, meetingUrl: meeting.meetingUrl }} />
          <Card>
            <CardContent className="flex flex-col gap-3">
              <h2>{t("edit")}</h2>
              <MeetingForm
                projectId={project.id}
                people={people}
                today={todayInVietnam()}
                meeting={{ id: meeting.id, kind: meeting.kind, title: meeting.title, heldOn: meeting.heldOn, startTime: meeting.startTime, durationMinutes: meeting.durationMinutes, attendeeIds: meeting.attendeeIds, externalAttendees: meeting.externalAttendees, agenda: meeting.agenda, notes: meeting.notes }}
              />
            </CardContent>
          </Card>
        </>
      ) : null}
    </Page>
  );
}
