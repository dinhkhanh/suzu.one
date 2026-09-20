import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canOpenAttendanceSettings } from "@/modules/attendance/policy";
import { requireUser } from "@/modules/platform/auth/session";

// Time clocks and their logs (FR-ATT-06). HR only; every page and action checks the entity again.
export default async function DevicesLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenAttendanceSettings(user.principal)) notFound();
  const t = await getTranslations("attendance.devices");
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <nav className="flex flex-wrap gap-4 border-b pb-2 text-sm">
        {(["devices", "import", "profiles"] as const).map((tab) => (
          <Link key={tab} href={tab === "devices" ? "/attendance/devices" : `/attendance/devices/${tab}`} className="underline-offset-4 hover:underline">
            {t(`tabs.${tab}`)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
