import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { getBalances, getLedger } from "@/modules/leave/ledger";
import { canOpenLeaveAdmin } from "@/modules/leave/policy";
import { listLeaveRequestsOf } from "@/modules/leave/requests";
import { CancelLeaveButton } from "@/modules/leave/ui/request-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("leave");

// The signed-in person's leave: what is left, what was asked for, and the way to ask for more.
export default async function LeavePage() {
  const user = await requireUser();
  const t = await getTranslations("leave");
  const format = await getFormatter();
  const locale = await getLocale();
  const today = todayInVietnam();
  const year = Number(today.slice(0, 4));
  const tAdmin = await getTranslations("leave.admin");
  // The person's own ledger (FR-LVE-07): this year and the next, where leave booked ahead lands.
  const [balances, requests, ledgerNext, ledgerThis] = await Promise.all([getBalances([user.person.id], year), listLeaveRequestsOf(user.person.id), getLedger(user.person.id, { year: year + 1 }), getLedger(user.person.id, { year })]);
  const ledger = [...ledgerNext, ...ledgerThis];
  const mine = balances.get(user.person.id) ?? [];
  const days = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2 });
  const signed = (centi: number) => format.number(centi / 100, { maximumFractionDigits: 2, signDisplay: "exceptZero" });
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "numeric", year: "numeric" });
  const dates = (from: string, to: string) => (from === to ? date(from) : `${date(from)} – ${date(to)}`);
  const statusOf = (request: (typeof requests)[number]) => (request.status === "pending" && request.approvalStatus === "returned" ? "returned" : request.status);
  const isOpen = (request: (typeof requests)[number]) => request.status === "pending" || (request.status === "approved" && request.startDate > today);

  const actions = (request: (typeof requests)[number]) => (
    <div className="flex items-center gap-2">
      <Link href={`/leave/new?amends=${request.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
        {t("request.amend")}
      </Link>
      <CancelLeaveButton leaveRequestId={request.id} label={request.status === "pending" ? t("request.withdraw") : t("request.cancel")} confirm={t("request.cancelConfirm")} />
    </div>
  );

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Link href="/leave/calendar" className={cn(buttonVariants({ variant: "outline" }))}>
              {t("calendar.title")}
            </Link>
            {canOpenLeaveAdmin(user.principal) ? (
              <Link href="/leave/admin/balances" className={cn(buttonVariants({ variant: "outline" }))}>
                {t("admin.title")}
              </Link>
            ) : null}
            <Link href="/leave/new" className={cn(buttonVariants())}>
              {t("request.new")}
            </Link>
          </>
        }
      />

      <Section title={t("balances.title", { year })}>
        {mine.length === 0 ? <p className="text-sm text-muted-foreground">{t("balances.none")}</p> : null}
        {mine.length > 0 ? (
          <TileGrid>
            {mine.map((row) => (
              <Tile
                key={row.leaveTypeId}
                label={locale === "en" && row.nameEn ? row.nameEn : row.name}
                value={days(row.availableCenti)}
                hint={`${t("balances.used", { days: days(row.usedCenti) })}${row.pendingCenti ? ` · ${t("balances.pending", { days: days(row.pendingCenti) })}` : ""}`}
              />
            ))}
          </TileGrid>
        ) : null}
      </Section>

      <Section title={t("request.mine")} count={requests.length || null}>
        <TableCard className="md:hidden">
          <List>
            {requests.length === 0 ? <ListEmpty>{t("request.none")}</ListEmpty> : null}
            {requests.map((request) => (
              <ListItem key={request.id} className="flex-col items-stretch gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {request.approvalRequestId ? (
                      <Link href={`/approvals/leave/${request.approvalRequestId}`} className="truncate font-medium">
                        {request.typeName}
                      </Link>
                    ) : (
                      <span className="truncate font-medium">{request.typeName}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {dates(request.startDate, request.endDate)} · <span className="font-mono tabular-nums">{t("daysCount", { days: days(request.totalCenti) })}</span>
                    </span>
                  </div>
                  <Badge dot variant={statusTone(statusOf(request))}>
                    {t(`status.${statusOf(request)}`)}
                  </Badge>
                </div>
                {isOpen(request) ? actions(request) : null}
              </ListItem>
            ))}
          </List>
          <TableAddRow label={t("request.new")} href="/leave/new" />
        </TableCard>

        <TableCard className="hidden md:flex">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("request.type")}</TableHead>
                <TableHead kind="date">{t("request.dates")}</TableHead>
                <TableHead kind="number">{t("request.cost")}</TableHead>
                <TableHead kind="status">{t("request.status")}</TableHead>
                <TableHead kind="actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.length === 0 ? <TableEmpty>{t("request.none")}</TableEmpty> : null}
              {requests.map((request) => (
                <TableRow key={request.id}>
                  <TableCell className="font-medium">
                    {request.approvalRequestId ? (
                      <Link href={`/approvals/leave/${request.approvalRequestId}`} className="hover:underline">
                        {request.typeName}
                      </Link>
                    ) : (
                      request.typeName
                    )}
                  </TableCell>
                  <TableCell>{dates(request.startDate, request.endDate)}</TableCell>
                  <TableCell kind="number">{days(request.totalCenti)}</TableCell>
                  <TableCell>
                    <Badge dot variant={statusTone(statusOf(request))}>
                      {t(`status.${statusOf(request)}`)}
                    </Badge>
                  </TableCell>
                  <TableCell kind="actions">{isOpen(request) ? <div className="flex justify-end">{actions(request)}</div> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TableAddRow label={t("request.new")} href="/leave/new" />
        </TableCard>
      </Section>

      <Section title={t("balances.ledger")} count={ledger.length || null} description={t("balances.ledgerHint")}>
        <TableCard className="md:hidden">
          <List>
            {ledger.length === 0 ? <ListEmpty>{t("balances.noLedger")}</ListEmpty> : null}
            {ledger.map((entry) => (
              <ListItem key={entry.id} className="flex-col items-stretch gap-0.5">
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-sm font-medium">
                    {tAdmin(`ledgerKinds.${entry.kind}`)} · {entry.typeName}
                  </span>
                  <span className="font-mono text-sm tabular-nums">{signed(entry.amountCenti)}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {date(entry.effectiveDate)}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </span>
              </ListItem>
            ))}
          </List>
        </TableCard>
        <TableCard className="hidden md:flex">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="date">{tAdmin("balances.date")}</TableHead>
                <TableHead kind="text">{tAdmin("balances.type")}</TableHead>
                <TableHead kind="select">{tAdmin("balances.movement")}</TableHead>
                <TableHead kind="number">{tAdmin("balances.days")}</TableHead>
                <TableHead kind="text">{tAdmin("balances.reason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.length === 0 ? <TableEmpty>{t("balances.noLedger")}</TableEmpty> : null}
              {ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{date(entry.effectiveDate)}</TableCell>
                  <TableCell>{entry.typeName}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tAdmin(`ledgerKinds.${entry.kind}`)}</Badge>
                  </TableCell>
                  <TableCell kind="number">{signed(entry.amountCenti)}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{entry.reason ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>
    </Page>
  );
}
