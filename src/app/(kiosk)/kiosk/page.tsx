import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { KIOSK_COOKIE, kioskOfToken } from "@/modules/attendance/kiosk";
import { KioskScreen } from "@/modules/attendance/ui/kiosk/kiosk-screen";

/**
 * The check-in kiosk on a wall tablet (FR-ATT-06). Nobody is signed in here: HR opened the kiosk
 * from Attendance → Kiosk and was signed out on this tablet in the same step, so what the tablet
 * holds is the kiosk's own cookie, good for one clock and nothing else. Without an open kiosk
 * behind it the page says how to open one, and shows nothing of the company.
 */
export const metadata: Metadata = { title: { absolute: "SuZu check-in" }, robots: { index: false, follow: false }, manifest: null };

export default async function KioskPage() {
  const kiosk = await kioskOfToken((await cookies()).get(KIOSK_COOKIE)?.value);
  if (kiosk) return <KioskScreen deviceName={kiosk.device.name} />;
  const t = await getTranslations("kiosk");
  return (
    <main className="fixed inset-0 grid place-items-center bg-neutral-950 p-6 text-white">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold">{t("notOpen.title")}</h1>
        <p className="text-white/80">{t("notOpen.body")}</p>
        <a href="/attendance/kiosk" className="rounded-[0.625rem] border border-white/40 px-4 py-2.5 text-sm font-medium hover:bg-white/10">
          {t("closed.signIn")}
        </a>
      </div>
    </main>
  );
}
