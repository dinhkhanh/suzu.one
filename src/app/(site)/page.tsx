import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LinkedText } from "@/components/site/legal-document";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/modules/platform/auth/session";

type Feature = { title: string; body: string };

// What SuZu One is, for somebody who is not signed in — Google's OAuth reviewers among them. A
// signed-in person has no use for it and goes straight to their day.
export default async function HomePage() {
  if (await getCurrentUser()) redirect("/today");

  const t = await getTranslations();
  const features = t.raw("site.features") as Feature[];
  const googleBody = t.raw("site.googleBody") as string[];

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("site.eyebrow")}</p>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-balance sm:text-4xl">{t("site.headline")}</h1>
        <p className="text-base text-muted-foreground">{t("site.lead")}</p>
        <div className="flex flex-col gap-3 pt-2">
          <Link href="/sign-in" className={buttonVariants({ size: "lg", className: "self-start" })}>
            {t("site.signIn")}
          </Link>
          <p className="text-sm text-muted-foreground">{t("site.audience")}</p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{t("site.featuresTitle")}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature.title} className="flex flex-col gap-1 rounded-xl border p-4">
              <p className="font-medium">{feature.title}</p>
              <p className="text-sm text-muted-foreground">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("site.googleTitle")}</h2>
        {googleBody.map((paragraph) => (
          <p key={paragraph} className="text-sm text-muted-foreground">{paragraph}</p>
        ))}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/privacy" className="font-medium underline underline-offset-4">{t("app.privacy")}</Link>
          <Link href="/terms" className="font-medium underline underline-offset-4">{t("app.terms")}</Link>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t("site.contactTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          <LinkedText text={t("site.contactBody")} />
        </p>
      </section>
    </div>
  );
}
