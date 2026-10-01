import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
  // The newest application the reader may see names the stage in the header.
  const latest = [...view.applications].sort((a, b) => b.appliedAt.getTime() - a.appliedAt.getTime())[0];

  const properties: { key: string; label: string; value: ReactNode; kind?: "email" | "phone" | "link" }[] = [
    { key: "email", label: t("form.email"), value: candidate.email ?? "—", kind: "email" },
    { key: "phone", label: t("form.phone"), value: candidate.phone ?? "—", kind: "phone" },
    { key: "source", label: t("columns.source"), value: t(`source.${candidate.source}`) },
    { key: "referredBy", label: t("form.referredBy"), value: view.referredByName ?? "—" },
    { key: "tags", label: t("columns.tags"), value: candidate.tags.length > 0 ? candidate.tags.join(", ") : "—" },
    ...candidate.links.map((link, index) => ({
      key: `link-${index}`,
      label: t("candidate.links"),
      kind: "link" as const,
      value: (
        // rel=noreferrer: a candidate's portfolio host learns nothing about our system.
        <a href={link} target="_blank" rel="noreferrer noopener">
          {link}
        </a>
      ),
    })),
  ];

  return (
    <Page>
      <PageHeader
        eyebrow={[candidate.currentTitle, candidate.currentEmployer, candidate.location].filter(Boolean).join(" · ") || undefined}
        title={candidate.fullName}
        actions={
          view.canManage ? (
            <Link href={`/recruit/candidates/${candidateId}/edit`} className={buttonVariants({ variant: "outline" })}>
              {t("actions.editCandidate")}
            </Link>
          ) : null
        }
      >
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {latest ? (
            <Badge dot variant={statusTone(latest.status)}>
              {latest.stageName}
            </Badge>
          ) : null}
          <Badge variant="outline">{t(`source.${candidate.source}`)}</Badge>
        </div>
      </PageHeader>

      <Section title={t("candidate.properties")}>
        <TableCard>
          <Table numbered={false}>
            <TableBody>
              {properties.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="w-40 whitespace-normal text-muted-foreground">{row.label}</TableCell>
                  <TableCell kind={row.kind} className="whitespace-normal">
                    {row.value}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>

      {candidate.notes ? (
        <Section title={t("form.notes")}>
          <RichText text={candidate.notes} className="rounded-[14px] border border-border bg-background p-4 text-sm text-muted-foreground" />
        </Section>
      ) : null}

      <Section title={t("openings")} count={view.applications.length || null}>
        <TableCard>
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
      </Section>

      <p className="text-xs text-faint">{t("confidential")}</p>
    </Page>
  );
}
