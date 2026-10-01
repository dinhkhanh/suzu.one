import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { entityReach } from "@/modules/platform/rbac/policy";
import { listExpenseClaims } from "@/modules/requests/expense";
import { canSettleExpenseClaims } from "@/modules/requests/policy";
import { SweepClaimsButton } from "@/modules/requests/ui/sweep-claims";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("expenseClaims");

// What the company owes its people, and where each claim has got to (FR-REQ-03). Finance's screen:
// whoever pays the payroll settles the claims, so the same permission opens both.
export default async function ExpenseClaimsPage() {
  const user = await requireUser();
  if (!canSettleExpenseClaims(user.principal)) redirect("/requests");

  const t = await getTranslations("requests.expense");
  const format = await getFormatter();
  const claims = await listExpenseClaims({ reach: entityReach(user.principal, "payroll:pay") });
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });

  const waiting = claims.filter((claim) => claim.status === "approved" && !claim.payment);
  const owed = waiting.reduce((total, claim) => total + claim.total, 0);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("financeTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("financeDescription", { count: waiting.length, amount: money(owed) })}</p>
        </div>
        <SweepClaimsButton label={t("sweep")} />
      </header>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("columns.requester")}</TableHead>
            <TableHead kind="text">{t("columns.summary")}</TableHead>
            <TableHead kind="date">{t("columns.filed")}</TableHead>
            <TableHead kind="status">{t("columns.status")}</TableHead>
            <TableHead kind="status">{t("columns.payment")}</TableHead>
            <TableHead kind="money">{t("amount")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {claims.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
          {claims.map((claim) => (
            <TableRow key={claim.requestId}>
              <TableCell>{claim.requesterName}</TableCell>
              <TableCell className="max-w-96 truncate">
                <Link href={`/approvals/request/${claim.requestId}`} className="font-medium hover:underline">
                  {claim.summary}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{format.dateTime(claim.createdAt, { dateStyle: "medium" })}</TableCell>
              <TableCell>
                <Badge dot variant={statusTone(claim.status)}>{t(`status.${claim.status}` as "status.approved")}</Badge>
              </TableCell>
              <TableCell>
                {claim.payment ? (
                  <Badge variant="secondary">{t("postedTo", { month: claim.payment.month })}</Badge>
                ) : claim.status === "approved" ? (
                  <Badge variant="outline">{t("awaitingPayroll")}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell kind="money">{money(claim.total)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
