import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { employeeTemplate } from "@/modules/core-hr/import";
import { historyTemplate } from "@/modules/core-hr/history-import";
import { commitEmployeeImportAction, commitHistoryImportAction, stageEmployeeImportAction, stageHistoryImportAction } from "@/modules/core-hr/import-actions";
import { peopleModuleOpen } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("importEmployees");

export default async function ImportPeoplePage() {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user)) || !can(user.principal, "person:manage")) notFound();
  const t = await getTranslations("people");

  return (
    <Page>
      <PageHeader
        title={t("import.title")}
        description={t("import.description")}
        actions={
          <Link href="/people" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("orgChart.backToList")}
          </Link>
        }
      />
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("import.notes.newOnly")}</li>
        <li>{t("import.notes.manager")}</li>
        <li>{t("import.notes.restricted")}</li>
        <li>{t("import.notes.phone")}</li>
      </ul>
      <ImportWizard title={t("import.wizard")} template={{ fileName: "employees.csv", csv: employeeTemplate() }} stageAction={stageEmployeeImportAction} commitAction={commitEmployeeImportAction} />
      <Section title={t("import.historyTitle")}>
        <p className="max-w-prose text-sm text-muted-foreground">{t("import.historyDescription")}</p>
        <ImportWizard title={t("import.historyWizard")} template={{ fileName: "work-history.csv", csv: historyTemplate() }} stageAction={stageHistoryImportAction} commitAction={commitHistoryImportAction} />
      </Section>
    </Page>
  );
}
