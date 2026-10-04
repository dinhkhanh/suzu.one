import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { headers } from "next/headers";
import { visitorOf } from "@/lib/public-action";
import { PREVIEW_DECISIONS, openPreviewLink } from "@/modules/work/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

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
 * The file is not a storage URL printed into the page — one signed here would run out while the
 * client was still reading the note. It is this link's own `file` route, which checks the token
 * again on every request and signs at that moment, so the file opens for as long as the link does.
 * A picture is shown in place through the same route and a video is **played** in place through it
 * — in the browser's own player, a plain `<video controls>`, because this page ships no script of
 * ours — with the file's name beside it as the download; anything else is a link to it.
 *
 * **A machine is not shown the work.** A chat app fetches the address the moment the link is
 * pasted, to draw its card. That is not the client opening it, so it is not counted or audited
 * (`openPreviewLink` answers `not_a_view` before it reads anything) and it gets a page that says
 * only that there is something to open — the same page for every token, real or not.
 *
 * **No answer is chosen for the client.** The three choices arrive unchecked: an approval freezes
 * the version and is the record of what was agreed, so it has to be something the client did, not
 * something the page did for them. The browser refuses the form without a choice (`required`) and
 * so does the action (`decideOnPreviewLink` validates it).
 *
 * Never indexed, never stored by a browser or a proxy: the URL *is* the credential (`next.config.ts`
 * adds `X-Robots-Tag` and `Cache-Control: no-store` for `/preview/*`, beside the tags below).
 */
export const dynamic = "force-dynamic";
/** Reading one link and what it points at. Anything slower than this is broken, not busy. */
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

  // A submission coming back. The thank-you is shown for `sent=1` **whatever the link's state**,
  // and without opening it: a client whose answer was recorded and a machine whose submission was
  // silently dropped must see the same page, or the honeypot announces itself to the one visitor
  // it is meant for. It can be typed by anybody, and says nothing about any link.
  if (query.sent === "1") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t("thanks.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("thanks.body")}</p>
      </div>
    );
  }

  const outcome = await openPreviewLink(token, visitorOf({ headers: new Headers(await headers()) }));

  if (!outcome.ok && outcome.reason === "not_a_view") {
    // What a chat app's card is drawn from: no client, no project, no title, no file.
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t("unfurl.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("unfurl.body")}</p>
      </div>
    );
  }

  if (!outcome.ok) {
    // One page, one sentence, never why.
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t("closed.title")}</h1>
        <p className="text-sm text-muted-foreground">{outcome.reason === "rate_limited" ? t("closed.busy") : t("closed.body")}</p>
      </div>
    );
  }

  const page = outcome.page;
  const error = typeof query.error === "string" ? query.error : null;
  const subtitle = [page.clientName, page.projectName].filter(Boolean).join(" · ");
  // The token is the only thing in the address, encoded as the form's action below encodes it.
  const fileHref = `/preview/${encodeURIComponent(token)}/file`;

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
        {page.kind === "file" ? (
          page.fileName ? (
            <>
              {page.fileIsImage ? (
                <a href={fileHref} target="_blank" rel="noopener noreferrer nofollow">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind this link's own route: the image optimiser cannot fetch it */}
                  <img src={fileHref} alt={page.fileName} className="mx-auto h-auto max-h-[80dvh] max-w-full rounded-lg border" />
                </a>
              ) : null}
              {/* The browser's own player, fed by the same route: it follows the redirect to storage
                  and asks storage for each stretch of the film. Only the first frames are fetched
                  until the client presses play. */}
              {page.fileIsVideo ? <video src={fileHref} controls preload="metadata" playsInline className="mx-auto max-h-[80dvh] w-full rounded-lg border bg-black" /> : null}
              <a href={fileHref} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-sm font-medium underline">
                {page.fileName}
              </a>
              <p className="text-xs text-muted-foreground">{page.fileIsVideo ? t("videoHint") : t("fileHint")}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
          )
        ) : page.url ? (
          <a href={page.url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-sm font-medium underline">
            {page.url}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
        )}
      </section>

      {page.message ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("messageFrom", { name: page.senderName })}</h2>
          {/* The note is built into the document allow-list and rendered from that, never as HTML. */}
          <RichText text={page.message} className="text-sm text-muted-foreground" />
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
            {/* The version being answered, so the answer is recorded against the work the client
                actually read — a tab left open while the work moved on is refused, not honoured. */}
            <input type="hidden" name="version" value={page.version} />

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">{t("decide.choice")}</legend>
              {/* None is checked: the client picks, and `required` holds the form until they have. */}
              {PREVIEW_DECISIONS.map((decision) => (
                <label key={decision} className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                  <input type="radio" name="decision" value={decision} required className="mt-0.5 size-4" />
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
