import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { PersonName } from "@/modules/platform/approvals/ui/person-name";
import { requireUser } from "@/modules/platform/auth/session";
import { entityReach } from "@/modules/platform/rbac/policy";
import { listPayouts, type PayoutRow } from "@/modules/requests/payments";
import { canPayRequests } from "@/modules/requests/policy";
import { MarkPaidButton } from "@/modules/requests/ui/mark-paid";
import { RequestTabs } from "@/modules/requests/ui/request-tabs";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("requestsToPay");

// Finance's "to pay" queue (REQ-01): every approved payment, purchase and advance in the entities
// the reader pays for, oldest approval first, with what a trip's advance already covered — then
// what was paid in the last sixty days, with its date and reference.
export default async function RequestsToPayPage() {
  const user = await requireUser();
  if (!canPayRequests(user.principal)) redirect("/requests");

  const today = todayInVietnam();
  const [t, tRequests, format, locale, rows] = await Promise.all([getTranslations("requests.pay"), getTranslations("requests"), getFormatter(), getLocale(), listPayouts(entityReach(user.principal, "payroll:pay"), { paidSince: addDays(today, -60) })]);
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
  const day = (value: Date | string | null) => (value ? format.dateTime(typeof value === "string" ? new Date(`${value}T00:00:00+07:00`) : value, { day: "numeric", month: "numeric", year: "numeric" }) : "—");

  const waiting = rows.filter((row) => !row.paidOn);
  const paid = rows.filter((row) => !!row.paidOn);
  const owed = waiting.filter((row) => !row.blocked).reduce((total, row) => total + Math.max(0, row.settlement.toPay), 0);
  const typeName = (row: PayoutRow) => (locale === "en" ? row.nameEn : row.nameVi);
  const figure = (row: PayoutRow) => (row.settlement.toPay < 0 ? t("toCollect", { amount: money(-row.settlement.toPay) }) : money(row.settlement.toPay));
  const action = (row: PayoutRow) =>
    row.paidOn ? (
      <span className="text-xs text-muted-foreground">
        {day(row.paidOn)} · {row.paidReference}
      </span>
    ) : row.blocked ? (
      <Badge variant="warning">{t("advanceUnpaid")}</Badge>
    ) : (
      <MarkPaidButton requestId={row.requestId} summary={row.summary} figure={figure(row)} defaultDate={today} />
    );
  const request = (row: PayoutRow) => (
    <span className="flex min-w-0 flex-col gap-0.5">
      <Link href={`/approvals/request/${row.requestId}`} className="font-medium hover:underline">
        {row.summary}
      </Link>
      <span className="text-xs text-muted-foreground">
        {typeName(row)} · {t(`kinds.${row.payout}`)}
        {row.parentRequestId ? (
          <>
            {" · "}
            <Link href={`/approvals/request/${row.parentRequestId}`} className="hover:underline">
              {row.parentSummary}
            </Link>
          </>
        ) : null}
      </span>
    </span>
  );
  const cells = (row: PayoutRow) => (
    <>
      <TableCell>
        <PersonName name={row.requesterName} personId={row.requesterPersonId} />
      </TableCell>
      <TableCell className="max-w-96 whitespace-normal">{request(row)}</TableCell>
      <TableCell kind="money">{money(row.amount)}</TableCell>
      <TableCell kind="money">{row.settlement.nettedAdvance ? money(row.settlement.nettedAdvance) : "—"}</TableCell>
      <TableCell kind="money">{figure(row)}</TableCell>
      <TableCell kind="date">{day(row.approvedAt)}</TableCell>
      <TableCell kind="actions">
        <div className="flex justify-end">{action(row)}</div>
      </TableCell>
    </>
  );

  return (
    <Page>
      <PageHeader title={tRequests("hub")} description={t("description", { count: waiting.length, amount: money(owed) })} />
      <RequestTabs active="pay" personId={user.person.id} principal={user.principal} payWaiting={waiting.length} />

      <TileGrid>
        <Tile label={t("waiting")} value={<>{waiting.length}</>} tone={waiting.length > 0 ? "warning" : undefined} />
        <Tile label={t("total")} value={<>{money(owed)}</>} />
      </TileGrid>

      <Section title={t("title")} count={waiting.length || undefined}>
        <Table containerClassName="hidden md:block">
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("columns.requester")}</TableHead>
              <TableHead kind="text">{t("columns.request")}</TableHead>
              <TableHead kind="money">{t("columns.amount")}</TableHead>
              <TableHead kind="money">{t("columns.advance")}</TableHead>
              <TableHead kind="money">{t("columns.toPay")}</TableHead>
              <TableHead kind="date">{t("columns.approved")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {waiting.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {waiting.map((row) => (
              <TableRow key={row.requestId}>{cells(row)}</TableRow>
            ))}
            {paid.length > 0 ? <TableGroupRow>{t("paidRecently", { count: paid.length })}</TableGroupRow> : null}
            {paid.map((row) => (
              <TableRow key={row.requestId} className="text-muted-foreground">
                {cells(row)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <List className="md:hidden">
          {waiting.length === 0 ? <ListEmpty>{t("none")}</ListEmpty> : null}
          {[...waiting, ...paid].map((row) => (
            <ListItem key={row.requestId} className="flex-col items-stretch gap-2">
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{row.requesterName}</span>
                <span className="font-mono text-[0.8125rem] text-foreground tabular-nums">{figure(row)}</span>
              </span>
              {request(row)}
              {row.settlement.nettedAdvance ? (
                <span className="text-xs text-muted-foreground">
                  {t("columns.amount")} {money(row.amount)} · {t("columns.advance")} {money(row.settlement.nettedAdvance)}
                </span>
              ) : null}
              <div>{action(row)}</div>
            </ListItem>
          ))}
        </List>
      </Section>
    </Page>
  );
}
