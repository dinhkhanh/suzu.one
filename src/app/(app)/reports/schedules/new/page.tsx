import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { canManageSchedules, listReportsFor } from "@/modules/reports/service";
import { ScheduleForm } from "@/modules/reports/ui/schedule-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newSchedule");

/** The report list is `listReportsFor(user, { forScheduling: true })` — what this person may read, minus what may never be emailed. */
export default async function NewSchedulePage() {
  const user = await requireUser();
  if (!canManageSchedules(user.principal)) notFound();
  const [reports, people, t, tCatalogue, locale] = await Promise.all([
    listReportsFor(user, { forScheduling: true }),
    listPersonNames(),
    getTranslations("reports.schedules"),
    getTranslations("reports.catalogue"),
    getLocale(),
  ]);
  if (reports.length === 0) notFound();
  const options = reports.map((report) => ({ key: report.key, label: tCatalogue.has(`${report.key}.name` as never) ? tCatalogue(`${report.key}.name` as never) : report.key }));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/reports/schedules" className="underline underline-offset-4">
            {t("title")}
          </Link>
        </p>
        <h1>{t("new")}</h1>
      </header>
      <ScheduleForm
        draft={{ id: null, reportKey: options[0].key, name: options[0].label, cadence: "weekly", dayOfWeek: 1, dayOfMonth: 1, locale, recipientPersonIds: [user.person.id] }}
        reports={options}
        people={people.map((person) => ({ id: person.id, name: person.fullName }))}
      />
    </div>
  );
}
