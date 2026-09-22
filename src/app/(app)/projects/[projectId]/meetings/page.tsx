import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { canRecordMeeting, listMeetings, type MeetingKind, meetingPeople, openProject } from "@/modules/projects/service";
import { MeetingForm } from "@/modules/projects/ui/collab-forms";
import { ProjectHeader } from "@/modules/projects/ui/project-header";

export const metadata: Metadata = { title: "Project meetings" };

/**
 * Meeting notes (FR-PJM-30): kick-offs, weekly and client meetings, and the retrospective held on
 * the close-out page. Each meeting's decisions go to the decision log and its action items become
 * tasks in the project. Calendar invitations are not sent from here (see the page's note).
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
    <div className="flex max-w-4xl flex-col gap-8">
      <ProjectHeader context={context} current="meetings" />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">{t("title")}</h2>
        {meetings.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {meetings.map((meeting) => (
            <li key={meeting.id}>
              <Link href={meeting.kind === "retro" ? `/projects/${project.id}/close` : `/projects/${project.id}/meetings/${meeting.id}`} className="flex flex-col gap-1 p-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{t(`kinds.${meeting.kind as MeetingKind}`)}</Badge>
                    <span className="truncate font-medium">{meeting.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{[date(meeting.heldOn), meeting.authorName, t("attendeesCount", { count: meeting.attendeeIds.length })].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex flex-wrap gap-1.5 text-xs">
                  {meeting.decisions ? <Badge variant="secondary">{t("decisionsCount", { count: meeting.decisions })}</Badge> : null}
                  {meeting.actionItems ? <Badge variant={meeting.openActionItems ? "warning" : "success"}>{t("actionsCount", { open: meeting.openActionItems, total: meeting.actionItems })}</Badge> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {records ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-base font-medium">{t("new")}</h2>
          <MeetingForm projectId={project.id} people={people} today={todayInVietnam()} />
          <p className="text-xs text-muted-foreground">{t("calendarNote")}</p>
        </section>
      ) : null}
    </div>
  );
}
