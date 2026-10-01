import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { eachDate } from "@/modules/attendance/engine/calendar";
import { canManageDevices } from "@/modules/attendance/policy";
import { getTeamMonth, monthEnd, monthStart } from "@/modules/attendance/timesheets";
import { RecomputeButton } from "@/modules/attendance/ui/device-forms";
import { MonthNav, TeamGrid } from "@/modules/attendance/ui/timesheet-views";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("teamTimesheet");

// The month of everyone whose timesheet the viewer may read: reports, the department (heads), HR's
// scope. Statuses and minutes only — never positions. Colleagues are not here at all.
export default async function TeamTimesheetPage({ searchParams }: PageProps<"/attendance/team">) {
  const user = await requireUser();
  const query = await searchParams;
  const t = await getTranslations("attendance.timesheet");
  const thisMonth = todayInVietnam().slice(0, 7);
  const month = typeof query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month) && query.month <= thisMonth ? query.month : thisMonth;
  const departmentId = typeof query.department === "string" && /^[0-9a-f-]{36}$/.test(query.department) ? query.department : null;
  const [{ rows, departments }, entities] = await Promise.all([getTeamMonth({ personId: user.person.id, principal: user.principal }, month, { departmentId }), listEntities()]);
  const mine = entities.filter((entity) => canManageDevices(user.principal, entity.id)).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const href = (value: string, department: string | null = departmentId) => `/attendance/team?month=${value}${department ? `&department=${department}` : ""}`;

  return (
    <Page width="full">
      <PageHeader
        title={t("team.title")}
        description={t("team.description")}
        actions={
          <>
            <RecomputeButton entities={mine} label={t("team.recompute")} doneLabel={t.raw("team.recomputeDone") as string} failedLabel={t("team.recomputeFailed")} />
            <MonthNav month={month} hrefFor={(value) => href(value)} thisMonth={thisMonth} />
          </>
        }
      />
      {departments.length > 1 ? (
        <nav className="tab-row">
          <Link href={href(month, null)} aria-current={departmentId ? undefined : "page"}>
            {t("team.allDepartments")}
          </Link>
          {departments.map((department) => (
            <Link key={department.id} href={href(month, department.id)} aria-current={departmentId === department.id ? "page" : undefined}>
              {department.name}
            </Link>
          ))}
        </nav>
      ) : null}
      <TeamGrid rows={rows} month={month} dates={eachDate(monthStart(month), monthEnd(month))} />
    </Page>
  );
}
