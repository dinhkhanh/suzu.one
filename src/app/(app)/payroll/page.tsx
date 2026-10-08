import { getTranslations } from "next-intl/server";
import { ChevronRightIcon } from "lucide-react";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canDecidePayRules, canReadPayRules, canSeeSimpleProfileReport, compensationReach, payrollReadReach } from "@/modules/payroll/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payroll");

type DeskKey = "mine" | "myPayslips" | "queries" | "reports" | "runs" | "salaries" | "profiles" | "simpleReport" | "netToGross" | "components" | "policy" | "statutory" | "parallel" | "ytd" | "bonus";

// The payroll desk. Everyone finds their own pay file here; what else is listed depends on the
// person's payroll permissions — and every linked page checks again.
export default async function PayrollPage() {
  const user = await requireUser();
  const t = await getTranslations("payroll");
  const reach = compensationReach(user.principal);
  const managesSomewhere = reach.all || reach.entityIds.length > 0;
  const readsRuns = payrollReadReach(user.principal);
  const mine: { href: string; key: DeskKey }[] = [
    { href: "/payslips", key: "myPayslips" },
    { href: `/payroll/salaries/${user.person.id}`, key: "mine" },
  ];
  const desk: { href: string; key: DeskKey }[] = [
    ...(readsRuns.all || readsRuns.entityIds.length > 0
      ? [
          { href: "/payroll/runs", key: "runs" as const },
          { href: "/payroll/reports", key: "reports" as const },
          { href: "/payroll/bonus", key: "bonus" as const },
        ]
      : []),
    ...(managesSomewhere ? [{ href: "/payroll/salaries", key: "salaries" as const }] : []),
    ...(managesSomewhere || canDecidePayRules(user.principal) ? [{ href: "/payroll/profiles", key: "profiles" as const }] : []),
    ...(canSeeSimpleProfileReport(user.principal) ? [{ href: "/payroll/profiles/simple", key: "simpleReport" as const }] : []),
    ...(managesSomewhere
      ? [
          { href: "/payroll/queries", key: "queries" as const },
          { href: "/payroll/tools/net-to-gross", key: "netToGross" as const },
          { href: "/payroll/statutory", key: "statutory" as const },
          { href: "/payroll/parallel", key: "parallel" as const },
          { href: "/payroll/ytd", key: "ytd" as const },
        ]
      : []),
    ...(canReadPayRules(user.principal)
      ? [
          { href: "/payroll/components", key: "components" as const },
          { href: "/payroll/policy", key: "policy" as const },
        ]
      : []),
  ];
  const rows = (links: { href: string; key: DeskKey }[]) => (
    <List>
      {links.map((link) => (
        <ListItem key={link.key} href={link.href}>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">{t(`desk.${link.key}.title`)}</span>
            <span className="text-xs text-muted-foreground">{t(`desk.${link.key}.description`)}</span>
          </span>
          <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-faint" />
        </ListItem>
      ))}
    </List>
  );
  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <Section title={t("desk.mineSection")}>{rows(mine)}</Section>
      {desk.length > 0 ? <Section title={t("desk.deskSection")}>{rows(desk)}</Section> : null}
    </Page>
  );
}
