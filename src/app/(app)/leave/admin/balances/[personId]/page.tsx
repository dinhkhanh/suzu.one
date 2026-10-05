import { storedText } from "@/lib/stored-text";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { getPersonTarget, listEmploymentFacts } from "@/modules/core-hr/service";
import { getBalances, getLedger } from "@/modules/leave/ledger";
import { canManageLeaveOf } from "@/modules/leave/policy";
import { listLeaveRequestsOf } from "@/modules/leave/requests";
import { AdjustBalanceForm } from "@/modules/leave/ui/admin-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("leaveLedger");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One person's balances with every movement behind them (FR-LVE-07): opening + movements = balance.
export default async function PersonLedgerPage(props: PageProps<"/leave/admin/balances/[personId]">) {
  const user = await requireUser();
  const { personId } = await props.params;
  const target = UUID.test(personId) ? await getPersonTarget(personId) : null;
  if (!target || !canManageLeaveOf(user.principal, target)) notFound();

  const t = await getTranslations("leave.admin");
  const tLeave = await getTranslations("leave");
  const tStored = await getTranslations("stored");
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
          <RecordLink kind="person" id={facts ? personId : null}>{facts?.fullName ?? "—"}</RecordLink>{facts?.employeeCode ? ` (${facts.employeeCode})` : ""} · {year}
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
      <TableCard>
        <TableCardHeader title={t("balances.ledger")} count={ledger.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("balances.date")}</TableHead>
              <TableHead kind="id">{t("balances.type")}</TableHead>
              <TableHead kind="select">{t("balances.movement")}</TableHead>
              <TableHead kind="number">{t("balances.days")}</TableHead>
              <TableHead kind="text">{t("balances.reason")}</TableHead>
              <TableHead kind="person">{t("balances.postedBy")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ledger.length === 0 ? <TableEmpty>{t("balances.noLedger")}</TableEmpty> : null}
            {ledger.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{date(entry.effectiveDate)}</TableCell>
                <TableCell kind="id">{entry.typeCode}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{t(`ledgerKinds.${entry.kind}`)}</Badge>
                </TableCell>
                <TableCell kind="number">{days(entry.amountCenti)}</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">{storedText(entry.reason, tStored) ?? ""}</TableCell>
                <TableCell className="text-muted-foreground">{entry.createdByName ? <RecordLink kind="person" id={entry.createdByPersonId}>{entry.createdByName}</RecordLink> : t("balances.system")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {mine.length > 0 ? (
          <TableAddRow label={t("balances.adjust")} open={ledger.length === 0}>
            <AdjustBalanceForm personId={personId} year={year} types={mine.map((row) => ({ id: row.leaveTypeId, name: row.name }))} />
          </TableAddRow>
        ) : null}
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("balances.requests")} count={requests.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{tLeave("request.type")}</TableHead>
              <TableHead kind="date">{tLeave("request.dates")}</TableHead>
              <TableHead kind="number">{tLeave("request.cost")}</TableHead>
              <TableHead kind="status">{tLeave("request.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.length === 0 ? <TableEmpty>{tLeave("request.none")}</TableEmpty> : null}
            {requests.map((request) => (
              <TableRow key={request.id}>
                <TableCell>
                  {request.approvalRequestId ? (
                    <Link href={`/approvals/leave/${request.approvalRequestId}`} className="font-medium hover:underline">
                      {request.typeName}
                    </Link>
                  ) : (
                    request.typeName
                  )}
                </TableCell>
                <TableCell>
                  {date(request.startDate)} – {date(request.endDate)}
                </TableCell>
                <TableCell kind="number">{plain(request.totalCenti)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{tLeave(`status.${request.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
