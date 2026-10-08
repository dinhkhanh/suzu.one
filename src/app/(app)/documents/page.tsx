import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { todayInVietnam } from "@/lib/dates";
import { canReadTemplates, DOCUMENT_KINDS, type DocumentKind, listIssuedDocuments, REGISTER_LIMIT } from "@/modules/documents/service";
import { exportIssuedDocumentsAction } from "@/modules/documents/export-actions";
import { IssuedDocumentsTable } from "@/modules/documents/ui/issued-documents";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("issuedDocuments");

// The register of issued papers (CHR-01): every contract, decision and letter the company has
// issued that this reader may open, newest first — the book a numbered paper is looked up in. HR's,
// like the template library; each row is re-checked against its subject and tier, and an offer
// letter (which recruitment renders about a candidate, not a person) is not in it.
export default async function IssuedDocumentsPage({ searchParams }: PageProps<"/documents">) {
  const user = await requireUser();
  if (!canReadTemplates(user.principal)) notFound();
  const query = await searchParams;
  const kinds = DOCUMENT_KINDS.filter((kind) => kind !== "offer");
  const kind = kinds.find((value) => value === query.kind) as DocumentKind | undefined;
  const thisYear = Number(todayInVietnam().slice(0, 4));
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];
  const year = years.find((value) => String(value) === query.year);

  const [t, tKind, te, locale, rows] = await Promise.all([getTranslations("documents"), getTranslations("documents.kind"), getTranslations("exports"), getLocale(), listIssuedDocuments(user.principal, { kind, year })]);

  return (
    <Page width="wide">
      <PageHeader
        title={t("register.title")}
        description={t("register.description")}
        actions={<ExportButton action={exportIssuedDocumentsAction} input={{ kind, year, locale }} label={te("button")} failedLabel={te("failed")} truncatedLabel={te("truncated")} />}
      />
      <form action="/documents" className="toolbar">
        <Select name="kind" defaultValue={kind ?? ""} aria-label={t("register.kind")} className="w-auto">
          <option value="">{t("register.allKinds")}</option>
          {kinds.map((value) => (
            <option key={value} value={value}>
              {tKind(value)}
            </option>
          ))}
        </Select>
        <Select name="year" defaultValue={year ? String(year) : ""} aria-label={t("register.year")} className="w-auto">
          <option value="">{t("register.allYears")}</option>
          {years.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {t("register.apply")}
        </Button>
      </form>
      <IssuedDocumentsTable rows={rows} title={t("register.issued")} empty={t("register.empty")} showSubject />
      {rows.length === REGISTER_LIMIT ? <p className="text-xs text-faint">{t("register.limited", { count: REGISTER_LIMIT })}</p> : null}
    </Page>
  );
}
