import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { requireUser } from "@/modules/platform/auth/session";

// HR's attendance configuration. Every page and action checks again what the viewer may change.
export default async function AttendanceSettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.settings");
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <nav className="tab-row border-b pb-2">
        {(["calendar", "schedules", "shifts", "locations", "policy"] as const).map((tab) => (
          <Link key={tab} href={`/attendance/settings/${tab}`} className="underline-offset-4 hover:underline">
            {t(`tabs.${tab}`)}
          </Link>
        ))}
        <Link href="/attendance/devices" className="underline-offset-4 hover:underline">
          {t("tabs.devices")}
        </Link>
      </nav>
      {children}
    </div>
  );
}
