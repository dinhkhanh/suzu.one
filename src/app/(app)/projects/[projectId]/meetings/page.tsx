import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canRecordMeeting, listMeetings, type MeetingKind, meetingPeople, openProject } from "@/modules/projects/service";
import { MeetingForm } from "@/modules/projects/ui/collab-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projectMeetings");

/**
 * Meeting notes (FR-PJM-30): kick-offs, weekly and client meetings, and the retrospective held on
 * the close-out page. Each meeting's decisions go to the decision log and its action items become
 * tasks in the project. A meeting given an hour can be put in the company calendar from its own
 * page, which says what the adapter really managed.
 */
export default async function ProjectMeetingsPage({ params }: PageProps<"/projects/[projectId]/meetings">) {
  const user = await requireUser();
  const { projectId } = await params;
  const context = await openProject(user, projectId);
  if (!context) notFound();
  const { project, viewer, facts } = context;
  const records = canRecordMeeting(viewer, facts);
  const [t, format, meetings, people] = await Promise.all([getTranslations("projects.meetings"), getFormatter(), listMeetings(project.id), records ? meetingPeople(project.id) : Promise.resolve([])]);
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });

  return (
    <Page>
      <ProjectHeader context={context} current="meetings" />

      <TableCard>
        <TableCardHeader title={t("title")} count={meetings.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("fields.title")}</TableHead>
              <TableHead kind="select">{t("fields.kind")}</TableHead>
              <TableHead kind="date">{t("fields.heldOn")}</TableHead>
              <TableHead kind="person">{t("fields.author")}</TableHead>
              <TableHead kind="number">{t("fields.attendees")}</TableHead>
              <TableHead kind="number">{t("fields.decisions")}</TableHead>
              <TableHead kind="status">{t("fields.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {meetings.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {meetings.map((meeting) => (
              <TableRow key={meeting.id}>
                <TableCell className="max-w-80">
                  <span className="flex items-center gap-2">
                    <Link href={meeting.kind === "retro" ? `/projects/${project.id}/close` : `/projects/${project.id}/meetings/${meeting.id}`} className="truncate font-medium hover:underline">
                      {meeting.title}
                    </Link>
                    {meeting.calendarEventId ? <Badge variant="outline">{t("inCalendar")}</Badge> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`kinds.${meeting.kind as MeetingKind}`)}</Badge>
                </TableCell>
                <TableCell>{[date(meeting.heldOn), meeting.startTime ? meeting.startTime.slice(0, 5) : null].filter(Boolean).join(" · ")}</TableCell>
                <TableCell>{meeting.authorName ? <RecordLink kind="person" id={meeting.createdByPersonId}>{meeting.authorName}</RecordLink> : "—"}</TableCell>
                <TableCell kind="number">{meeting.attendeeIds.length}</TableCell>
                <TableCell kind="number">{meeting.decisions}</TableCell>
                <TableCell>{meeting.actionItems ? <Badge dot variant={meeting.openActionItems ? "warning" : "success"}>{t("actionsCount", { open: meeting.openActionItems, total: meeting.actionItems })}</Badge> : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {records ? (
          <TableAddRow label={t("new")} open={meetings.length === 0}>
            <div className="flex flex-col gap-3">
              <MeetingForm projectId={project.id} people={people} today={todayInVietnam()} />
              <p className="text-xs text-muted-foreground">{t("calendarNote")}</p>
            </div>
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
