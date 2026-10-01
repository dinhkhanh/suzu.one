import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <div className="toolbar justify-between">
        <Segmented aria-label={t("balances.title")} value={String(year)} options={[year - 1, year, year + 1].map((value) => ({ value: String(value), label: String(value), href: `/leave/admin/balances?year=${value}` }))} />
        {can(user.principal, "leave:manage", {}) ? <RunAccrualsButton /> : null}
      </div>
      <p className="text-sm text-muted-foreground">{t("balances.hint")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("balances.person")}</TableHead>
            <TableHead kind="org">{t("balances.unit")}</TableHead>
            {codes.map((code) => (
              <TableHead key={code} kind="number">
                {code}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("balances.noPeople")}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.personId}>
              <TableCell>
                <Link href={`/leave/admin/balances/${row.personId}?year=${year}`} className="font-medium hover:underline">
                  {row.fullName}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{[row.entityName, row.departmentName].filter(Boolean).join(" · ")}</TableCell>
              {codes.map((code) => {
                const balance = row.balances.find((candidate) => candidate.code === code);
                return (
                  <TableCell key={code} kind="number">
                    {balance ? days(balance.balanceCenti) : "—"}
                    {balance?.pendingCenti ? <span className="text-xs text-muted-foreground"> (−{days(balance.pendingCenti)})</span> : null}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
