import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Page, PageHeader } from "@/components/ui/page";
import { nextKioskDirection } from "@/modules/attendance/devices";
import { kioskOfQrToken } from "@/modules/attendance/kiosk";
import { QrCheckIn } from "@/modules/attendance/ui/kiosk/kiosk-admin";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("kioskCheckIn");

// Opened by scanning a kiosk's QR code with one's own phone (FR-ATT-06): the kiosk did not know the
// face, or the person would rather not use it. The code is fresh for under a minute; the check-in
// itself is a button, so a link preview or a prefetch never punches anybody.
export default async function KioskCheckInPage({ searchParams }: PageProps<"/attendance/check-in/kiosk">) {
  const user = await requireUser();
  const t = await getTranslations("attendance.kiosk.scan");
  const errors = await getTranslations("attendance.kiosk.errors");
  const token = (await searchParams).t;
  const [kiosk, way] = await Promise.all([typeof token === "string" ? kioskOfQrToken(token) : null, nextKioskDirection(user.person.id)]);
  return (
    <Page width="narrow">
      <PageHeader title={t("title")} description={kiosk ? t("at", { device: kiosk.device.name }) : undefined} />
      {kiosk && typeof token === "string" ? <QrCheckIn token={token} way={way} /> : <Alert variant="warning">{errors("kiosk_code_expired")}</Alert>}
    </Page>
  );
}
