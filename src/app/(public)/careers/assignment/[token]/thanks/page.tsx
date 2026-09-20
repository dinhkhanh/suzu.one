import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

// The one answer a submission gets: received. Nothing about what was received, whether it was the
// first attempt, or what happens next — the recruiter says that, in their own words.
export const metadata: Metadata = { title: "—", robots: { index: false, follow: false } };

export default async function AssignmentThanksPage() {
  const t = await getTranslations("recruit.assignment");
  return (
    <div className="flex flex-col items-start gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("thanks.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("thanks.body")}</p>
    </div>
  );
}
