import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canOpenLeaveAdmin } from "@/modules/leave/policy";
import { requireUser } from "@/modules/platform/auth/session";

// HR's side of leave. Every page and action checks again what the viewer may change.
export default async function LeaveAdminLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (!canOpenLeaveAdmin(user.principal)) notFound();
  const t = await getTranslations("leave.admin");
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <nav className="flex flex-wrap gap-4 border-b pb-2 text-sm">
        {(["balances", "types", "staffing", "import"] as const).map((tab) => (
          <Link key={tab} href={`/leave/admin/${tab}`} className="underline-offset-4 hover:underline">
            {t(`tabs.${tab}`)}
          </Link>
        ))}
        <Link href="/leave" className="ml-auto text-muted-foreground underline-offset-4 hover:underline">
          {t("myLeave")}
        </Link>
      </nav>
      {children}
    </div>
  );
}
