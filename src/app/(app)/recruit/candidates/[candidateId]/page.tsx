import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { getCandidateView } from "@/modules/recruit/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("candidate");

// One candidate and everywhere they have applied — only the applications whose opening the reader
// may see, so the page cannot be used to learn that somebody applied elsewhere in the group.
export default async function CandidatePage({ params }: PageProps<"/recruit/candidates/[candidateId]">) {
  const { candidateId } = await params;
  const user = await requireUser();
  const view = await getCandidateView({ principal: user.principal, personId: user.person.id }, candidateId);
  if (!view) notFound();

  const t = await getTranslations("recruit");
  const format = await getFormatter();
  const { candidate } = view;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{candidate.fullName}</h1>
          <p className="text-sm text-muted-foreground">{[candidate.currentTitle, candidate.currentEmployer, candidate.location].filter(Boolean).join(" · ")}</p>
        </div>
        {view.canManage ? (
          <Link href={`/recruit/candidates/${candidateId}/edit`} className="text-sm underline underline-offset-4">
            {t("save")}
          </Link>
        ) : null}
      </header>

      <dl className="grid gap-2 rounded-xl border p-4 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("form.email")}</dt>
          <dd>{candidate.email ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("form.phone")}</dt>
          <dd>{candidate.phone ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("columns.source")}</dt>
          <dd>{t(`source.${candidate.source}`)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{t("form.referredBy")}</dt>
          <dd>{view.referredByName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:col-span-2">
          <dt className="text-muted-foreground">{t("columns.tags")}</dt>
          <dd>{candidate.tags.length > 0 ? candidate.tags.join(", ") : "—"}</dd>
        </div>
      </dl>

      {candidate.links.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {candidate.links.map((link) => (
            <li key={link}>
              {/* rel=noreferrer: a candidate's portfolio host learns nothing about our system. */}
              <a href={link} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                {link}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {candidate.notes ? <p className="whitespace-pre-line rounded-xl border p-4 text-sm text-muted-foreground">{candidate.notes}</p> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("openings")}</h2>
        {view.applications.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {view.applications.map((row) => (
              <li key={row.applicationId} className="flex flex-wrap items-center gap-3 p-3">
                <Link href={`/recruit/applications/${row.applicationId}`} className="min-w-0 flex-1 text-sm font-medium hover:underline">
                  {row.openingTitle}
                </Link>
                <span className="text-xs text-muted-foreground">{row.stageName}</span>
                <span className="text-xs text-muted-foreground">{format.dateTime(row.appliedAt, { dateStyle: "medium" })}</span>
                <Badge variant={row.status === "active" ? "default" : "outline"}>{t(`applicationStatus.${row.status}`)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-muted-foreground">{t("confidential")}</p>
    </div>
  );
}
