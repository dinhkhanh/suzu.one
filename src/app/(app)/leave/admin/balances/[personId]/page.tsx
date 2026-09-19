import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { todayInVietnam } from "@/lib/dates";
import { getPersonTarget, listEmploymentFacts } from "@/modules/core-hr/service";
import { getBalances, getLedger } from "@/modules/leave/ledger";
import { canManageLeaveOf } from "@/modules/leave/policy";
import { listLeaveRequestsOf } from "@/modules/leave/requests";
import { AdjustBalanceForm } from "@/modules/leave/ui/admin-forms";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Leave ledger" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One person's balances with every movement behind them (FR-LVE-07): opening + movements = balance.
export default async function PersonLedgerPage(props: PageProps<"/leave/admin/balances/[personId]">) {
  const user = await requireUser();
  const { personId } = await props.params;
  const target = UUID.test(personId) ? await getPersonTarget(personId) : null;
  if (!target || !canManageLeaveOf(user.principal, target)) notFound();

  const t = await getTranslations("leave.admin");
  const tLeave = await getTranslations("leave");
  const format = await getFormatter();
  const current = Number(todayInVietnam().slice(0, 4));
  const asked = Number((await props.searchParams).year);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : current;
  const [balances, ledger, requests, [facts]] = await Promise.all([getBalances([personId], year), getLedger(personId, { year }), listLeaveRequestsOf(personId, 20), listEmploymentFacts({ personIds: [personId] })]);
  const mine = balances.get(personId) ?? [];
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const plain = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "numeric", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {facts?.fullName ?? "—"}{facts?.employeeCode ? ` (${facts.employeeCode})` : ""} · {year}
        </h2>
        <Link href={`/leave/new?person=${personId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {t("balances.fileFor")}
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {mine.map((row) => (
          <li key={row.leaveTypeId} className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{row.name}</p>
            <p className="text-2xl font-semibold tabular-nums">{plain(row.balanceCenti)}</p>
            <p className="text-xs text-muted-foreground">
              {tLeave("balances.used", { days: plain(row.usedCenti) })}
              {row.pendingCenti ? ` · ${tLeave("balances.pending", { days: plain(row.pendingCenti) })}` : ""}
            </p>
          </li>
        ))}
      </ul>
      {mine.length > 0 ? <AdjustBalanceForm personId={personId} year={year} types={mine.map((row) => ({ id: row.leaveTypeId, name: row.name }))} /> : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("balances.ledger")}</h3>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <tbody>
              {ledger.map((entry) => (
                <tr key={entry.id} className="border-b last:border-0">
                  <td className="p-2 whitespace-nowrap">{date(entry.effectiveDate)}</td>
                  <td className="p-2">{entry.typeCode}</td>
                  <td className="p-2">
                    <Badge variant="secondary">{t(`ledgerKinds.${entry.kind}`)}</Badge>
                  </td>
                  <td className="p-2 text-right tabular-nums">{days(entry.amountCenti)}</td>
                  <td className="p-2 text-muted-foreground">{entry.reason ?? ""}</td>
                  <td className="p-2 text-xs text-muted-foreground">{entry.createdByName ?? t("balances.system")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ledger.length === 0 ? <p className="text-sm text-muted-foreground">{t("balances.noLedger")}</p> : null}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("balances.requests")}</h3>
        <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <span className="min-w-0 flex-1">
                {request.approvalRequestId ? (
                  <Link href={`/approvals/leave/${request.approvalRequestId}`} className="font-medium hover:underline">
                    {request.typeName}
                  </Link>
                ) : (
                  request.typeName
                )}{" "}
                <span className="text-muted-foreground">
                  {date(request.startDate)} – {date(request.endDate)} · {tLeave("daysCount", { days: plain(request.totalCenti) })}
                </span>
              </span>
              <Badge variant="outline">{tLeave(`status.${request.status}`)}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
