import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { commitKpiActualsAction, stageKpiActualsAction } from "@/modules/performance/kpi-actions";
import { kpiActualTemplate } from "@/modules/performance/kpi-import";
import { canOpenKpiAdmin } from "@/modules/performance/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("importKPIActuals");

export default async function KpiImportPage() {
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenKpiAdmin((await requireUser()).principal)) notFound();
  const t = await getTranslations("performance.import");
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("notes.period")}</li>
        <li>{t("notes.overwrite")}</li>
        <li>{t("notes.closed")}</li>
      </ul>
      <ImportWizard title={t("wizard")} template={{ fileName: "kpi-actuals.csv", csv: kpiActualTemplate() }} stageAction={stageKpiActualsAction} commitAction={commitKpiActualsAction} />
    </div>
  );
}
