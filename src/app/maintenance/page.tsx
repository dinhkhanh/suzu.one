import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("maintenance"))("title") };
}

/**
 * What every page shows while the app is closed (`MAINTENANCE_MODE`, the proxy sends each page
 * here): the mark and two sentences, on paper, naming nothing — the public domain shows it too. It
 * reads nothing, since the database may be in the middle of a restore, and outside maintenance
 * there is nothing to see here.
 */
export default async function MaintenancePage() {
  if (env().MAINTENANCE_MODE !== "on") redirect("/");
  const t = await getTranslations("maintenance");
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
        <Logo className="size-14 text-brand" />
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("body")}</p>
      </div>
    </main>
  );
}
