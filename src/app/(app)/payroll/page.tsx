import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireUser } from "@/modules/platform/auth/session";
import { canDecidePayRules, canReadPayRules, canSeeSimpleProfileReport, compensationReach, payrollReadReach } from "@/modules/payroll/policy";

export const metadata: Metadata = { title: "Payroll" };

// The payroll desk. Everyone finds their own pay file here; what else is listed depends on the
// person's payroll permissions — and every linked page checks again.
export default async function PayrollPage() {
  const user = await requireUser();
  const t = await getTranslations("payroll");
  const reach = compensationReach(user.principal);
  const managesSomewhere = reach.all || reach.entityIds.length > 0;
  const readsRuns = payrollReadReach(user.principal);
  const links: { href: string; key: "mine" | "myPayslips" | "queries" | "runs" | "salaries" | "profiles" | "simpleReport" | "netToGross" | "components" | "policy" }[] = [
    { href: "/payslips", key: "myPayslips" },
    { href: `/payroll/salaries/${user.person.id}`, key: "mine" },
    ...(readsRuns.all || readsRuns.entityIds.length > 0 ? [{ href: "/payroll/runs", key: "runs" as const }] : []),
    ...(managesSomewhere ? [{ href: "/payroll/salaries", key: "salaries" as const }] : []),
    ...(managesSomewhere || canDecidePayRules(user.principal) ? [{ href: "/payroll/profiles", key: "profiles" as const }] : []),
    ...(canSeeSimpleProfileReport(user.principal) ? [{ href: "/payroll/profiles/simple", key: "simpleReport" as const }] : []),
    ...(managesSomewhere ? [{ href: "/payroll/queries", key: "queries" as const }, { href: "/payroll/tools/net-to-gross", key: "netToGross" as const }] : []),
    ...(canReadPayRules(user.principal) ? [{ href: "/payroll/components", key: "components" as const }, { href: "/payroll/policy", key: "policy" as const }] : []),
  ];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <li key={link.key}>
            <Link href={link.href} className="flex h-full flex-col gap-1 rounded-xl border p-4 hover:bg-muted">
              <span className="text-sm font-medium">{t(`desk.${link.key}.title`)}</span>
              <span className="text-sm text-muted-foreground">{t(`desk.${link.key}.description`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
