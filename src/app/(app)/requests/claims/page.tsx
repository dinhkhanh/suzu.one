import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { entityReach } from "@/modules/platform/rbac/policy";
import { listExpenseClaims } from "@/modules/requests/expense";
import { canSettleExpenseClaims } from "@/modules/requests/policy";
import { SweepClaimsButton } from "@/modules/requests/ui/sweep-claims";

export const metadata: Metadata = { title: "Expense claims" };

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
          <h1 className="text-2xl font-semibold tracking-tight">{t("financeTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("financeDescription", { count: waiting.length, amount: money(owed) })}</p>
        </div>
        <SweepClaimsButton label={t("sweep")} />
      </header>

      {claims.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("columns.requester")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("columns.summary")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("columns.filed")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("columns.status")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("columns.payment")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.requestId} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap">{claim.requesterName}</td>
                  <td className="px-3 py-2">
                    <Link href={`/approvals/request/${claim.requestId}`} className="hover:underline">
                      {claim.summary}
                    </Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{format.dateTime(claim.createdAt, { dateStyle: "medium" })}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{t(`status.${claim.status}` as "status.approved")}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {claim.payment ? (
                      <Badge variant="secondary">{t("postedTo", { month: claim.payment.month })}</Badge>
                    ) : claim.status === "approved" ? (
                      <Badge variant="outline">{t("awaitingPayroll")}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{money(claim.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
