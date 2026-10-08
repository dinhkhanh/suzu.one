// The row of tabs the payroll desk shares: runs, salaries, the year-end bonus and the reports —
// each one of the existing pages, each shown only to someone who may open it (the page checks
// again).
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { Principal } from "@/modules/platform/rbac/policy";
import { compensationReach, payrollReadReach } from "../policy";

export type PayrollTab = "runs" | "salaries" | "bonus" | "reports";

export async function PayrollTabs({ active, principal }: { active: PayrollTab; principal: Principal }) {
  const t = await getTranslations("payroll.tabs");
  const reads = payrollReadReach(principal);
  const readsRuns = reads.all || reads.entityIds.length > 0;
  const manages = compensationReach(principal);
  const managesSomewhere = manages.all || manages.entityIds.length > 0;
  const tabs: { key: PayrollTab; href: string; label: string }[] = [
    ...(readsRuns ? [{ key: "runs" as const, href: "/payroll/runs", label: t("runs") }] : []),
    ...(managesSomewhere ? [{ key: "salaries" as const, href: "/payroll/salaries", label: t("salaries") }] : []),
    ...(readsRuns
      ? [
          { key: "bonus" as const, href: "/payroll/bonus", label: t("bonus") },
          { key: "reports" as const, href: "/payroll/reports", label: t("reports") },
        ]
      : []),
  ];
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={t("label")} className="tab-row">
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} aria-current={tab.key === active ? "page" : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
