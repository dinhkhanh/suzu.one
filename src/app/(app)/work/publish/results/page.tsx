import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { commitResultsImportAction, stageResultsImportAction } from "@/modules/work/delivery-actions";
// Not through the service barrel: the import definition builds its actions when loaded.
import { resultTemplate } from "@/modules/work/results-import";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("importPostResults");

// FR-PJM-57: the figures of published posts, as exported from the platforms' dashboards — one line
// per post and date. Each line is matched to a post of a task the importer may change; nothing else
// is found, so the page is open to every employee.
export default async function PublishResultsImportPage() {
  const user = await requireUser();
  if (user.principal.workforceType === "collaborator") notFound();
  const t = await getTranslations("work");
  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-x-1.5">
            <Link href="/work" className="hover:underline">
              {t("title")}
            </Link>
            <span className="text-faint">/</span>
            <Link href="/work/calendar" className="hover:underline">
              {t("calendar.title")}
            </Link>
          </span>
        }
        title={t("results.importTitle")}
        description={t("results.importDescription")}
      />
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("results.notes.match")}</li>
        <li>{t("results.notes.reading")}</li>
        <li>{t("results.notes.again")}</li>
      </ul>
      <ImportWizard title={t("results.importWizard")} template={{ fileName: "ket-qua-bai-dang.csv", csv: resultTemplate() }} stageAction={stageResultsImportAction} commitAction={commitResultsImportAction} />
    </Page>
  );
}
