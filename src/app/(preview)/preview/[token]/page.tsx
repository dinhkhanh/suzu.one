import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { visitorOf } from "@/lib/public-action";
import { PREVIEW_DECISIONS, openPreviewLink } from "@/modules/work/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * One version of one piece of work, as the client holding the link sees it (D24, FR-PJM-51a).
 *
 * Built like the take-home brief next door and for the same reasons: a plain HTML form posting to a
 * route handler, no client bundle of ours, no identifier of any kind on the page, and **one answer
 * for every way the link can fail**. An expired link, a revoked one, one already decided and a
 * token nobody ever issued are a single closed page — a page that distinguished them would be a
 * machine for probing tokens.
 *
 * What is on it, and nothing else: the client's own brand, the project (unless it is private), the
 * title of the work, its version, the file or link, the note the account manager wrote, and the
 * sender's name. No other task, no internal comment, no fee, no colleague, no navigation anywhere.
 *
 * Never indexed, never stored by a browser or a proxy: the URL *is* the credential (`next.config.ts`
 * adds `X-Robots-Tag` and `Cache-Control: no-store` for `/preview/*`, beside the tags below).
 */
export const dynamic = "force-dynamic";
/** Reading one row, signing one URL. Anything slower than this is broken, not busy. */
export const maxDuration = 15;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("preview");
  // Deliberately the same for every link: a browser's history, a screenshot and a shared tab say
  // nothing about which client or which piece of work.
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default async function PreviewPage({ params, searchParams }: PageProps<"/preview/[token]">) {
  const { token } = await params;
  const query = await searchParams;
  const t = await getTranslations("preview");
  const format = await getFormatter();
  const outcome = await openPreviewLink(token, visitorOf({ headers: new Headers(await headers()) }));

  if (!outcome.ok) {
    // One page, one sentence, never why. `sent` is the client's own submission coming back: they
    // are told their answer arrived, and nothing else — it can be typed by anybody and says
    // nothing about the link, which is exactly the point.
    const justSent = outcome.reason === "closed" && query.sent === "1";
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{justSent ? t("thanks.title") : t("closed.title")}</h1>
        <p className="text-sm text-muted-foreground">{justSent ? t("thanks.body") : outcome.reason === "rate_limited" ? t("closed.busy") : t("closed.body")}</p>
      </div>
    );
  }

  const page = outcome.page;
  const error = typeof query.error === "string" ? query.error : null;
  const subtitle = [page.clientName, page.projectName].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
        <h1 className="text-xl font-semibold">{page.title}</h1>
        <p className="text-sm text-muted-foreground">
          {t("version", { version: page.version })}
          {page.recipientLabel ? ` · ${t("forWhom", { name: page.recipientLabel })}` : ""}
        </p>
      </header>

      <section className="flex flex-col gap-2 rounded-xl border p-4">
        <h2 className="text-sm font-medium">{t("work")}</h2>
        {page.url ? (
          <a href={page.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-sm font-medium underline">
            {page.kind === "file" ? (page.fileName ?? t("openFile")) : page.url}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">{page.fileName ?? t("unavailable")}</p>
        )}
        {page.kind === "file" ? <p className="text-xs text-muted-foreground">{t("fileHint")}</p> : null}
      </section>

      {page.message ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("messageFrom", { name: page.senderName })}</h2>
          {/* Plain text: a note typed into a textarea is not a place to start rendering markup. */}
          <p className="whitespace-pre-line text-sm text-muted-foreground">{page.message}</p>
        </section>
      ) : null}

      {page.allowDecision ? (
        <section className="flex flex-col gap-4 rounded-xl border p-4">
          <h2 className="text-base font-medium">{t("decide.title")}</h2>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {t.has(`errors.${error}`) ? t(`errors.${error}` as "errors.failed") : t("errors.failed")}
            </p>
          ) : null}

          <form method="post" action={`/preview/${encodeURIComponent(token)}/decide`} className="flex flex-col gap-4">
            {/* The honeypot: no person can see it, so anything in it is a machine. */}
            <div aria-hidden className="hidden">
              <label htmlFor="website">Website</label>
              <input id="website" type="text" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t("decide.choice")}</legend>
              {PREVIEW_DECISIONS.map((decision, index) => (
                <label key={decision} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                  <input type="radio" name="decision" value={decision} defaultChecked={index === 0} required className="mt-0.5 size-4" />
                  <span>
                    <span className="font-medium">{t(`decide.decisions.${decision}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`decide.hints.${decision}`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="decidedByName">{t("decide.name")}</Label>
              <Input id="decidedByName" name="decidedByName" required maxLength={120} placeholder={t("decide.namePlaceholder")} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="comment">{t("decide.comment")}</Label>
              <textarea id="comment" name="comment" rows={4} maxLength={4000} className="w-full rounded-lg border bg-transparent px-3 py-2 text-base md:text-sm" />
              <p className="text-xs text-muted-foreground">{t("decide.commentHint")}</p>
            </div>

            <Button type="submit" className="self-start">
              {t("decide.submit")}
            </Button>
          </form>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">{t("viewOnly")}</p>
      )}

      <section className="flex flex-col gap-1 border-t pt-4 text-xs text-muted-foreground">
        <p>{t("expiresOn", { date: format.dateTime(page.expiresAt, { dateStyle: "long" }) })}</p>
        {/* PDPL (NFR-PRV-02): what this page keeps, in the words of what it keeps. */}
        <p>{t("privacy")}</p>
      </section>
    </div>
  );
}
