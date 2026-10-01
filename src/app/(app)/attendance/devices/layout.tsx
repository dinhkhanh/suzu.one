import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { DevicesTabs } from "@/modules/attendance/ui/settings-tabs";
import { requireUser } from "@/modules/platform/auth/session";

// Time clocks and their logs (FR-ATT-06). HR only; every page and action checks the entity again.
export default async function DevicesLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.devices");
  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />
      <DevicesTabs labels={{ devices: t("tabs.devices"), import: t("tabs.import"), profiles: t("tabs.profiles") }} />
      {children}
    </Page>
  );
}
