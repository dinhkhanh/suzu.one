import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { MAX_SUBMISSION_BYTES, findPublicAssignment } from "@/modules/recruit/assignments";
import { ASSIGNMENT_LIMITS } from "@/modules/recruit/enums";

/**
 * A take-home brief, as the candidate holding the link sees it (FR-REC-07).
 *
 * The same shape as the application form and for the same reasons: a plain HTML form posting
 * multipart to a route handler, no client bundle, no identifier of any kind on the page, and one
 * answer for every way the link can fail. An expired brief, a cancelled one, one already sent back
 * and a token nobody ever issued are a single 404 — a page that distinguished them would be a
 * machine for probing tokens.
 *
 * Never indexed: the URL *is* the credential.
 */
export const metadata: Metadata = { title: "—", robots: { index: false, follow: false } };

export default async function AssignmentPage({ params, searchParams }: PageProps<"/careers/assignment/[token]">) {
  const { token } = await params;
  const assignment = await findPublicAssignment(token);
  if (!assignment) notFound();

  const query = await searchParams;
  const error = typeof query.error === "string" ? query.error : null;
  const t = await getTranslations("recruit.assignment");
  const format = await getFormatter();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1>{assignment.title}</h1>
        <p className="text-sm text-muted-foreground">
          {[assignment.companyName, assignment.jobTitle].filter(Boolean).join(" · ")}
        </p>
        <p className="text-sm">
          {t("due")}: {format.dateTime(assignment.dueAt, { dateStyle: "full", timeStyle: "short" })}
        </p>
      </header>

      {/* Plain text. A brief is typed into a textarea and is not a place to start rendering markup. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("brief")}</h2>
        <p className="whitespace-pre-line text-sm text-muted-foreground">{assignment.brief}</p>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-base font-medium">{t("submit")}</h2>
        {error ? (
          <p role="alert" className="text-sm text-destructive">{t.has(`errors.${error}`) ? t(`errors.${error}` as "errors.failed") : t("errors.failed")}</p>
        ) : null}

        <form method="post" action={`/careers/assignment/${encodeURIComponent(token)}/submit`} encType="multipart/form-data" className="flex flex-col gap-4">
          {/* The honeypot: no person can see it, so anything in it is a machine. */}
          <div aria-hidden className="hidden">
            <label htmlFor="website">Website</label>
            <input id="website" type="text" name="website" tabIndex={-1} autoComplete="off" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="file">{t("file")}</Label>
            <input id="file" type="file" name="file" accept={ACCEPT_ATTRIBUTE} className="text-sm" />
            <p className="text-xs text-muted-foreground">{t("fileHint", { megabytes: Math.round(MAX_SUBMISSION_BYTES / (1024 * 1024)) })}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="links">{t("links")}</Label>
            <textarea id="links" name="links" rows={3} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" placeholder="https://" />
            <p className="text-xs text-muted-foreground">{t("linksHint", { count: ASSIGNMENT_LIMITS.links })}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="note">{t("note")}</Label>
            <textarea id="note" name="note" rows={4} maxLength={ASSIGNMENT_LIMITS.note} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
          </div>

          <Button type="submit" className="self-start">
            {t("submit")}
          </Button>
        </form>
      </section>
    </div>
  );
}
