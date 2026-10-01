import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { SettingsTabs } from "@/modules/attendance/ui/settings-tabs";
import { requireUser } from "@/modules/platform/auth/session";

// HR's attendance configuration. Every page and action checks again what the viewer may change.
export default async function AttendanceSettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.settings");
  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsTabs labels={{ calendar: t("tabs.calendar"), schedules: t("tabs.schedules"), shifts: t("tabs.shifts"), locations: t("tabs.locations"), policy: t("tabs.policy"), devices: t("tabs.devices") }} />
      {children}
    </Page>
  );
}
