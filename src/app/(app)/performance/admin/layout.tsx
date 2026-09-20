import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canOpenKpiAdmin } from "@/modules/performance/service";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { requireUser } from "@/modules/platform/auth/session";

// HR's side of KPIs. Every page and action checks again what the viewer may change.
export default async function KpiAdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenKpiAdmin(user.principal)) notFound();
  const t = await getTranslations("performance.admin");
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <PerformanceNav active="admin" />
      <nav className="flex flex-wrap gap-4 text-sm">
        {(["periods", "cycles", "weighting", "assignments", "positions", "library", "import"] as const).map((tab) => (
          <Link key={tab} href={`/performance/admin/${tab}`} className="underline-offset-4 hover:underline">
            {t(`tabs.${tab}`)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
