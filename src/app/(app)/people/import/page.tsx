import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { employeeTemplate } from "@/modules/core-hr/import";
import { commitEmployeeImportAction, stageEmployeeImportAction } from "@/modules/core-hr/import-actions";
import { peopleModuleOpen } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Import employees" };

export default async function ImportPeoplePage() {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user)) || !can(user.principal, "person:manage")) notFound();
  const t = await getTranslations("people");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1>{t("import.title")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("import.description")}</p>
        </div>
        <Link href="/people" className={buttonVariants({ variant: "outline" })}>
          {t("orgChart.backToList")}
        </Link>
      </header>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("import.notes.newOnly")}</li>
        <li>{t("import.notes.manager")}</li>
        <li>{t("import.notes.restricted")}</li>
        <li>{t("import.notes.phone")}</li>
      </ul>
      <ImportWizard title={t("import.wizard")} template={{ fileName: "employees.csv", csv: employeeTemplate() }} stageAction={stageEmployeeImportAction} commitAction={commitEmployeeImportAction} />
    </div>
  );
}
