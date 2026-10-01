import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { canOpenLeaveAdmin } from "@/modules/leave/policy";
import { LeaveAdminTabs } from "@/modules/leave/ui/admin-tabs";
import { requireUser } from "@/modules/platform/auth/session";

// HR's side of leave. Every page and action checks again what the viewer may change.
export default async function LeaveAdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenLeaveAdmin(user.principal)) notFound();
  const t = await getTranslations("leave.admin");
  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />
      <LeaveAdminTabs labels={{ balances: t("tabs.balances"), types: t("tabs.types"), staffing: t("tabs.staffing"), import: t("tabs.import") }} myLeave={t("myLeave")} />
      {children}
    </Page>
  );
}
