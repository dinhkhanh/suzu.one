import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { listBalancesForAdmin } from "@/modules/leave/admin";
import { canOpenLeaveAdmin } from "@/modules/leave/policy";
import { RunAccrualsButton } from "@/modules/leave/ui/admin-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("leaveBalances");

export default async function LeaveBalancesPage(props: PageProps<"/leave/admin/balances">) {
  const user = await requireUser();
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenLeaveAdmin(user.principal)) notFound();
  const t = await getTranslations("leave.admin");
  const format = await getFormatter();
  const current = Number(todayInVietnam().slice(0, 4));
  const asked = Number((await props.searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : current;
  const rows = await listBalancesForAdmin(user.principal, year);
  const codes = [...new Set(rows.flatMap((row) => row.balances.map((balance) => balance.code)))];
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-3">
          {[year - 1, year, year + 1].map((value) => (
            <Link key={value} href={`/leave/admin/balances?year=${value}`} className={value === year ? "font-semibold" : "text-muted-foreground hover:underline"}>
              {value}
            </Link>
          ))}
        </div>
        {can(user.principal, "leave:manage", {}) ? <RunAccrualsButton /> : null}
      </div>
      <p className="text-sm text-muted-foreground">{t("balances.hint")}</p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="p-2 font-medium">{t("balances.person")}</th>
              <th className="p-2 font-medium">{t("balances.unit")}</th>
              {codes.map((code) => (
                <th key={code} className="p-2 text-right font-medium">
                  {code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.personId} className="border-b last:border-0">
                <td className="p-2">
                  <Link href={`/leave/admin/balances/${row.personId}?year=${year}`} className="font-medium hover:underline">
                    {row.fullName}
                  </Link>
                </td>
                <td className="p-2 text-muted-foreground">{[row.entityName, row.departmentName].filter(Boolean).join(" · ")}</td>
                {codes.map((code) => {
                  const balance = row.balances.find((candidate) => candidate.code === code);
                  return (
                    <td key={code} className="p-2 text-right tabular-nums">
                      {balance ? days(balance.balanceCenti) : "—"}
                      {balance?.pendingCenti ? <span className="text-xs text-muted-foreground"> (−{days(balance.pendingCenti)})</span> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
