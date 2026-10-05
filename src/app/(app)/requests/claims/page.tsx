import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableEmpty, TableGroupRow, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { PersonName } from "@/modules/platform/approvals/ui/person-name";
import { RequestAge } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { entityReach } from "@/modules/platform/rbac/policy";
import { claimsOwed, listExpenseClaims } from "@/modules/requests/expense";
import { canSettleExpenseClaims } from "@/modules/requests/policy";
import { RequestTabs } from "@/modules/requests/ui/request-tabs";
import { SweepClaimsButton } from "@/modules/requests/ui/sweep-claims";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("expenseClaims");

// What the company owes its people, and where each claim has got to (FR-REQ-03). Finance's screen:
// whoever pays the payroll settles the claims, so the same permission opens both.
export default async function ExpenseClaimsPage() {
  const user = await requireUser();
  if (!canSettleExpenseClaims(user.principal)) redirect("/requests");

  const reach = entityReach(user.principal, "payroll:pay");
  // What is owed is counted by Postgres over every claim, not over the newest the list shows.
  const [t, tApprovals, tRequests, format, claims, owed] = await Promise.all([getTranslations("requests.expense"), getTranslations("approvals"), getTranslations("requests"), getFormatter(), listExpenseClaims({ reach }), claimsOwed(reach)]);
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });

  // The desk's order: what is owed first, what is still being decided, then what is done with.
  const settled = claims.filter((claim) => !!claim.payment || (claim.status !== "approved" && claim.status !== "pending" && claim.status !== "returned"));
  const live = claims.filter((claim) => !settled.includes(claim));

  const paymentBadge = (claim: (typeof claims)[number]) =>
    claim.payment ? <Badge variant="secondary">{t("postedTo", { month: claim.payment.month })}</Badge> : claim.status === "approved" ? <Badge variant="warning">{t("awaitingPayroll")}</Badge> : <span className="text-faint">—</span>;

  const cells = (claim: (typeof claims)[number]) => (
    <>
      <TableCell>
        <PersonName name={claim.requesterName} personId={claim.requesterPersonId} />
      </TableCell>
      <TableCell className="max-w-96 whitespace-normal">
        <Link href={`/approvals/request/${claim.requestId}`} className="font-medium hover:underline">
          {claim.summary}
        </Link>
      </TableCell>
      <TableCell kind="money">{money(claim.total)}</TableCell>
      <TableCell>
        <Badge dot variant={statusTone(claim.status)}>{t(`status.${claim.status}` as "status.approved")}</Badge>
      </TableCell>
      <TableCell>{paymentBadge(claim)}</TableCell>
      <TableCell kind="time">
        <RequestAge createdAt={claim.createdAt} decidedAt={claim.decidedAt} />
      </TableCell>
    </>
  );

  return (
    <Page>
      <PageHeader title={tRequests("hub")} description={t("financeDescription", { count: owed.count, amount: money(owed.amount) })} actions={<SweepClaimsButton label={t("sweep")} />} />
      <RequestTabs active="claims" personId={user.person.id} principal={user.principal} claimsWaiting={owed.count} />

      <TileGrid>
        <Tile label={t("awaitingPayroll")} value={<>{owed.count}</>} tone={owed.count > 0 ? "warning" : undefined} />
        <Tile label={t("owed")} value={<>{money(owed.amount)}</>} />
      </TileGrid>

      <Section title={t("financeTitle")} count={claims.length || undefined}>
        <Table containerClassName="hidden md:block">
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("columns.requester")}</TableHead>
              <TableHead kind="text">{t("columns.summary")}</TableHead>
              <TableHead kind="money">{t("amount")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
              <TableHead kind="status">{t("columns.payment")}</TableHead>
              <TableHead kind="time">{tApprovals("columns.age")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {live.map((claim) => (
              <TableRow key={claim.requestId}>{cells(claim)}</TableRow>
            ))}
            {settled.length > 0 ? <TableGroupRow>{tApprovals("resolved", { count: settled.length })}</TableGroupRow> : null}
            {settled.map((claim) => (
              <TableRow key={claim.requestId} className="text-muted-foreground">
                {cells(claim)}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <List className="md:hidden">
          {claims.length === 0 ? <ListEmpty>{t("none")}</ListEmpty> : null}
          {[...live, ...settled].map((claim) => (
            <ListItem key={claim.requestId} href={`/approvals/request/${claim.requestId}`} className="flex-col items-stretch gap-1">
              <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{claim.requesterName}</span>
                <span className="font-mono text-[0.8125rem] text-foreground tabular-nums">{money(claim.total)}</span>
              </span>
              <span className="line-clamp-2 text-sm font-medium">{claim.summary}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Badge dot variant={statusTone(claim.status)}>{t(`status.${claim.status}` as "status.approved")}</Badge>
                {paymentBadge(claim)}
              </span>
            </ListItem>
          ))}
        </List>
      </Section>
    </Page>
  );
}
