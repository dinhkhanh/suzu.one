import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { commitOpeningBalancesAction, stageOpeningBalancesAction } from "@/modules/leave/actions";
import { openingBalanceTemplate } from "@/modules/leave/import";
import { canOpenLeaveAdmin } from "@/modules/leave/policy";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("importLeaveBalances");

export default async function LeaveImportPage() {
  // The layout checks too, but a layout is not re-rendered on client navigation.
  if (!canOpenLeaveAdmin((await requireUser()).principal)) notFound();
  const t = await getTranslations("leave.admin");
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("import.description")}</p>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("import.notes.asOf")}</li>
        <li>{t("import.notes.once")}</li>
        <li>{t("import.notes.accrual")}</li>
      </ul>
      <ImportWizard title={t("import.wizard")} template={{ fileName: "leave-opening-balances.csv", csv: openingBalanceTemplate() }} stageAction={stageOpeningBalancesAction} commitAction={commitOpeningBalancesAction} />
    </div>
  );
}
