import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

// The one answer every submission gets. It says the application was received and nothing else —
// not who it was from, not whether they had applied before, not what was done with it.
export const metadata: Metadata = { title: "Cảm ơn", robots: { index: false, follow: false } };

export default async function CareersThanksPage() {
  const t = await getTranslations("recruit.careers");
  return (
    <div className="flex flex-col items-start gap-4">
      <h1>{t("thanks.title")}</h1>
      <p className="text-sm text-muted-foreground">{t("thanks.body")}</p>
      <Link href="/careers" className={buttonVariants({ variant: "outline", size: "sm" })}>
        {t("thanks.back")}
      </Link>
    </div>
  );
}
