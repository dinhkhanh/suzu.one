// The person's own face enrolment, on their own page (ATT-02, NFR-PRV-01): that the kiosk knows
// their face, since when they consented, and the way to withdraw. Biometric data, read for the
// signed-in person only and never cached. Nothing shows for someone who was never enrolled.
import { getFormatter, getTranslations } from "next-intl/server";
import { Section } from "@/components/ui/page";
import { faceStatusOf } from "../faces";
import { WithdrawFaceConsentButton } from "./withdraw-face";

export async function MyFaceEnrolment({ personId }: { personId: string }) {
  const status = (await faceStatusOf([personId])).get(personId);
  if (!status) return null;
  const [t, format] = await Promise.all([getTranslations("attendance.myFace"), getFormatter()]);
  return (
    <Section title={t("title")}>
      <p className="text-sm">{t("enrolled", { count: status.templates, date: format.dateTime(status.consentAt, { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }) })}</p>
      <p className="text-sm text-muted-foreground">{t("what")}</p>
      <div>
        <WithdrawFaceConsentButton />
      </div>
    </Section>
  );
}
