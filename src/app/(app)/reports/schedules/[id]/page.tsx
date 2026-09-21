import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { canEditSchedule, listReportsFor, listSchedules } from "@/modules/reports/service";
import { ScheduleForm } from "@/modules/reports/ui/schedule-forms";

export const metadata: Metadata = { title: "Schedule" };

/** One schedule: its settings, and what its last runs actually delivered — and withheld. */
export default async function SchedulePage({ params }: PageProps<"/reports/schedules/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const schedules = await listSchedules({ personId: user.person.id, principal: user.principal });
  const schedule = schedules.find((row) => row.id === id);
  if (!schedule || !canEditSchedule({ personId: user.person.id, principal: user.principal }, schedule)) notFound();

  const [reports, people, t, tCatalogue, format] = await Promise.all([
    listReportsFor(user, { forScheduling: true }),
    listPersonNames(),
    getTranslations("reports.schedules"),
    getTranslations("reports.catalogue"),
    getFormatter(),
  ]);
  const label = (key: string) => (tCatalogue.has(`${key}.name` as never) ? tCatalogue(`${key}.name` as never) : key);
  // The schedule's own report stays on the list even if this reader may no longer choose it anew,
  // so the select has something to show; saving re-checks and refuses.
  const options = [...new Map([...reports.map((report) => report.key), schedule.reportKey].map((key) => [key, { key, label: label(key) }])).values()];
  const day = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/schedules" className="underline underline-offset-4">
            {t("title")}
          </Link>
        </p>
        <h1>{schedule.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t("nextRun")}: {day(schedule.nextRunOn)} · {t("lastRun")}: {day(schedule.lastRunOn)}
        </p>
      </header>

      <ScheduleForm
        draft={{
          id: schedule.id,
          reportKey: schedule.reportKey,
          name: schedule.name,
          cadence: schedule.cadence,
          dayOfWeek: schedule.dayOfWeek,
          dayOfMonth: schedule.dayOfMonth,
          locale: schedule.locale,
          recipientPersonIds: schedule.recipients.map((recipient) => recipient.personId),
        }}
        reports={options}
        people={people.map((person) => ({ id: person.id, name: person.fullName }))}
      />

      {schedule.lastRun ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("lastRun")}</h2>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={schedule.lastRun.status === "succeeded" ? "default" : schedule.lastRun.status === "failed" ? "destructive" : "secondary"}>{t(`runStatus.${schedule.lastRun.status}`)}</Badge>
            <span className="text-muted-foreground">
              {day(schedule.lastRun.runOn)} · {t("delivered", { count: schedule.lastRun.delivered })}
              {schedule.lastRun.withheld > 0 ? ` · ${t("withheld", { count: schedule.lastRun.withheld })}` : ""}
            </span>
          </div>
        </section>
      ) : null}
    </div>
  );
}
