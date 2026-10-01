import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { getCandidateView } from "@/modules/recruit/service";
import { pageTitle } from "@/i18n/page-title";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

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

      <RichText text={candidate.notes} className="rounded-xl border p-4 text-sm text-muted-foreground" />

      <TableCard>
        <TableCardHeader title={t("openings")} count={view.applications.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("reports.opening")}</TableHead>
              <TableHead kind="select">{t("columns.stage")}</TableHead>
              <TableHead kind="date">{t("columns.appliedAt")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.applications.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {view.applications.map((row) => (
              <TableRow key={row.applicationId}>
                <TableCell className="max-w-80 truncate">
                  <Link href={`/recruit/applications/${row.applicationId}`} className="font-medium hover:underline">
                    {row.openingTitle}
                  </Link>
                </TableCell>
                <TableCell>{row.stageName}</TableCell>
                <TableCell>{format.dateTime(row.appliedAt, { dateStyle: "medium" })}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.status)}>{t(`applicationStatus.${row.status}`)}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <p className="text-xs text-muted-foreground">{t("confidential")}</p>
    </div>
  );
}
