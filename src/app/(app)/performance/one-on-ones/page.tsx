import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listOneOnOnes, myReports } from "@/modules/performance/service";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { NewOneOnOneForm } from "@/modules/performance/ui/one-on-one-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("oneOnOneMeetings");

/** Every 1:1 the viewer is a party to — as the manager or as the person it is about (FR-PRF-04). */
export default async function OneOnOnesPage() {
  const user = await requireUser();
  const [t, format, meetings, reports] = await Promise.all([getTranslations("performance.oneOnOnes"), getFormatter(), listOneOnOnes(user.person.id), myReports(user.person.id)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <PerformanceNav active={null} />

      <ul className="flex flex-col gap-2">
        {meetings.map(({ row, managerName, personName, actionCount }) => (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
            <Link href={`/performance/one-on-ones/${row.id}`} className="font-medium underline">
              {format.dateTime(new Date(`${row.meetingOn}T00:00:00+07:00`), { dateStyle: "medium" })} · {row.managerPersonId === user.person.id ? t("with", { name: personName }) : t("with", { name: managerName })}
            </Link>
            <span className="flex items-center gap-2 text-muted-foreground">
              {actionCount > 0 ? <span className="text-xs">{t("actions.title")}: {actionCount}</span> : null}
              <Badge variant={row.status === "shared" ? "secondary" : "outline"}>{t(`status.${row.status}`)}</Badge>
            </span>
          </li>
        ))}
      </ul>
      {meetings.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}

      {reports.length > 0 ? <NewOneOnOneForm reports={reports} today={todayInVietnam()} /> : null}
    </div>
  );
}
