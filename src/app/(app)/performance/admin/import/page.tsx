import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { commitKpiActualsAction, stageKpiActualsAction } from "@/modules/performance/kpi-actions";
import { kpiActualTemplate } from "@/modules/performance/kpi-import";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";

export const metadata: Metadata = { title: "Import KPI actuals" };

export default async function KpiImportPage() {
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
