import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { canOpenKioskPage } from "@/modules/attendance/policy";
import { KioskTabs } from "@/modules/attendance/ui/settings-tabs";
import { requireUser } from "@/modules/platform/auth/session";

// The face kiosk (FR-ATT-06): the tablets open as kiosks, and the faces they know. For whoever
// holds `attendance:kiosk`; every page and action checks the clock or the person again.
export default async function KioskLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenKioskPage(user.principal)) notFound();
  const t = await getTranslations("attendance.kiosk");
  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />
      <KioskTabs labels={{ kiosks: t("tabs.kiosks"), faces: t("tabs.faces") }} />
      {children}
    </Page>
  );
}
