import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { visitorOf } from "@/lib/public-action";
import { DEFAULT_RETENTION_MONTHS } from "@/modules/recruit/enums";
import { countPrivacyView, findPublicPrivacyView } from "@/modules/recruit/privacy";

/**
 * A candidate's own page about what is kept of them (FR-REC-13; NFR-PRV-01, 03), opened from the
 * link in their letters. One fact — whether they are in the talent pool — and the one thing they
 * can do about it here: leave. **Nothing about the person** is on it: not their name, not their
 * address, not the jobs they applied for.
 *
 * A retired link, an emptied record and a token nobody issued are the same 404, and a visitor over
 * the read limit gets it too: a page that told them apart would be a machine for probing tokens.
 * Never indexed: the URL is the credential.
 */
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("recruit.careers"))("privacy.title"), robots: { index: false, follow: false } };
}

export default async function CareersPrivacyPage({ params, searchParams }: PageProps<"/careers/privacy/[token]">) {
  const { token } = await params;
  const allowed = await countPrivacyView(visitorOf({ headers: new Headers(await headers()) }));
  if (!allowed.ok) notFound();
  const view = await findPublicPrivacyView(token);
  if (!view) notFound();

  const query = await searchParams;
  const left = query.left === "1";
  const error = typeof query.error === "string" ? query.error : null;
  const t = await getTranslations("recruit.careers");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1>{t("privacy.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("privacy.intro", { months: DEFAULT_RETENTION_MONTHS })}</p>
      </header>

      <section className="flex flex-col gap-3 rounded-xl border p-4">
        <h2 className="text-base font-medium">{t("privacy.poolTitle")}</h2>
        {left ? <p className="text-sm">{t("privacy.left", { months: DEFAULT_RETENTION_MONTHS })}</p> : null}
        {!left ? <p className="text-sm">{view.inTalentPool ? t("privacy.inPool") : t("privacy.notInPool", { months: DEFAULT_RETENTION_MONTHS })}</p> : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t.has(`privacy.errors.${error}`) ? t(`privacy.errors.${error}` as "privacy.errors.failed") : t("privacy.errors.failed")}
          </p>
        ) : null}
        {view.inTalentPool ? (
          // A plain form posting to a route: no client bundle, and the answer is a redirect.
          <form method="post" action={`/careers/privacy/${encodeURIComponent(token)}/leave`}>
            <Button type="submit" size="sm" variant="outline">
              {t("privacy.leave")}
            </Button>
          </form>
        ) : null}
      </section>

      <p className="text-xs text-muted-foreground">{t("privacy.erasure")}</p>
    </div>
  );
}
