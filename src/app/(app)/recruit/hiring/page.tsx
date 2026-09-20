import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { canRunRecruitment, headcountPlan, listHiringRequests } from "@/modules/recruit/service";

export const metadata: Metadata = { title: "Hiring requests" };

// The asks: mine, the ones I will manage, and — for a recruiter — everything in scope. The
// headcount block below is FR-CHR-17 in the small: approved heads against the ones advertised.
export default async function HiringRequestsPage() {
  const user = await requireUser();
  const t = await getTranslations("recruit");
  const format = await getFormatter();
  const [rows, plan] = await Promise.all([listHiringRequests(user.principal), canRunRecruitment(user.principal) ? headcountPlan(user.principal) : Promise.resolve([])]);

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("hiring")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/recruit/hiring/new" className={buttonVariants({ size: "sm" })}>
          {t("newHiring")}
        </Link>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noHiring")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <Link href={`/recruit/hiring/${row.id}`} className="text-sm font-medium hover:underline">
                  {row.positionTitle} × {row.headcount}
                </Link>
                <p className="text-xs text-muted-foreground">{[row.entityName, row.departmentName, row.requesterName].filter(Boolean).join(" · ")}</p>
              </div>
              <span className="text-xs text-muted-foreground">{format.dateTime(row.createdAt, { dateStyle: "medium" })}</span>
              <Badge variant={row.status === "pending" ? "secondary" : "outline"}>{t(`hiringStatus.${row.status}`)}</Badge>
            </li>
          ))}
        </ul>
      )}

      {plan.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("headcount")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {plan.map((row) => (
              <li key={`${row.entityName}-${row.departmentId}`} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-0 flex-1">{[row.entityName, row.departmentName].filter(Boolean).join(" · ")}</span>
                <span className="text-xs text-muted-foreground">
                  {t("columns.approved")}: {row.approvedHeads}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("columns.open")}: {row.openHeads}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
