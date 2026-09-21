import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { canReadOneOnOne, canReadOneOnOnePrivate, canWriteOneOnOne, findOneOnOne, loadDirectory, loadOneOnOne } from "@/modules/performance/service";
import { AddActionForm, CompleteActionButton, EditOneOnOneForm, ShareOneOnOneButton } from "@/modules/performance/ui/one-on-one-forms";

export const metadata: Metadata = { title: "1:1 meeting" };

/**
 * One 1:1. The manager's private notes are stripped by the service before they reach here, so a
 * page that forgot to check could not leak them; the check is made anyway (FR-PRF-04).
 */
export default async function OneOnOnePage({ params }: PageProps<"/performance/one-on-ones/[meetingId]">) {
  const user = await requireUser();
  const { meetingId } = await params;
  const found = await findOneOnOne(meetingId);
  if (!found) notFound();
  const directory = await loadDirectory();
  const subject = directory.get(found.personId);
  if (!subject) notFound();
  const parties = { managerPersonId: found.managerPersonId, person: subject };
  if (!canReadOneOnOne(user.principal, parties)) notFound();

  const seesPrivate = canReadOneOnOnePrivate(user.principal, parties);
  const mayWrite = canWriteOneOnOne(user.principal, parties);
  const [t, format, meeting] = await Promise.all([getTranslations("performance.oneOnOnes"), getFormatter(), loadOneOnOne(meetingId, { seesPrivate })]);
  if (!meeting) notFound();

  const people = [
    { id: meeting.personId, fullName: meeting.personName },
    { id: meeting.managerPersonId, fullName: meeting.managerName },
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <Link href="/performance/one-on-ones" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1 className="flex flex-wrap items-center gap-2">
          {format.dateTime(new Date(`${meeting.meetingOn}T00:00:00+07:00`), { dateStyle: "long" })}
          <Badge variant={meeting.status === "shared" ? "secondary" : "outline"}>{t(`status.${meeting.status}`)}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {meeting.managerName} · {meeting.personName}
        </p>
      </header>

      {mayWrite ? (
        <EditOneOnOneForm meeting={{ id: meeting.id, meetingOn: meeting.meetingOn, agenda: meeting.agenda, sharedNotes: meeting.sharedNotes, privateNotes: meeting.privateNotes }} seesPrivate={seesPrivate} />
      ) : (
        <dl className="flex flex-col gap-3 rounded-xl border p-4 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("agenda")}</dt>
            <dd className="whitespace-pre-wrap">{meeting.agenda ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("sharedNotes")}</dt>
            <dd className="whitespace-pre-wrap">{meeting.sharedNotes ?? "—"}</dd>
          </div>
        </dl>
      )}

      {mayWrite && meeting.status === "draft" ? <ShareOneOnOneButton meetingId={meeting.id} /> : null}

      <section className="flex flex-col gap-3">
        <h2>{t("actions.title")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border px-4 text-sm">
          {meeting.actions.map((action) => (
            <li key={action.id} className="flex flex-wrap items-baseline justify-between gap-3 py-2">
              <span>
                {action.title}
                {action.dueOn ? <span className="ml-2 text-xs text-muted-foreground">{action.dueOn}</span> : null}
              </span>
              <span className="flex items-center gap-3">
                {action.taskId ? <span className="text-xs text-muted-foreground">{t("actions.task")}</span> : null}
                {mayWrite || action.assigneePersonId === user.person.id ? <CompleteActionButton actionId={action.id} /> : null}
              </span>
            </li>
          ))}
        </ul>
        {meeting.actions.length === 0 ? <p className="text-sm text-muted-foreground">{t("actions.empty")}</p> : null}
        {mayWrite ? <AddActionForm meetingId={meeting.id} people={people} /> : null}
      </section>
    </div>
  );
}
