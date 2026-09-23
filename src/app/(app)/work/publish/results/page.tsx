import { getTranslations } from "next-intl/server";
import Link from "next/link";
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
    <div className="flex max-w-4xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/work" className="underline">
            {t("title")}
          </Link>
          {" / "}
          <Link href="/work/calendar" className="underline">
            {t("calendar.title")}
          </Link>
        </p>
        <h1>{t("results.importTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("results.importDescription")}</p>
      </header>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("results.notes.match")}</li>
        <li>{t("results.notes.reading")}</li>
        <li>{t("results.notes.again")}</li>
      </ul>
      <ImportWizard title={t("results.importWizard")} template={{ fileName: "ket-qua-bai-dang.csv", csv: resultTemplate() }} stageAction={stageResultsImportAction} commitAction={commitResultsImportAction} />
    </div>
  );
}
