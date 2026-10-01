import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { assetTemplate } from "@/modules/assets/import";
import { commitAssetImportAction, stageAssetImportAction } from "@/modules/assets/import-actions";
import { canManageAssets } from "@/modules/assets/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("importAssets");

export default async function ImportAssetsPage() {
  const user = await requireUser();
  if (!canManageAssets(user.principal)) notFound();
  const t = await getTranslations("assets.import");

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/assets" className={buttonVariants({ variant: "outline" })}>
            {t("back")}
          </Link>
        }
      />
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("notes.newOnly")}</li>
        <li>{t("notes.code")}</li>
        <li>{t("notes.holder")}</li>
        <li>{t("notes.serial")}</li>
      </ul>
      <ImportWizard title={t("wizard")} template={{ fileName: "assets.csv", csv: assetTemplate() }} stageAction={stageAssetImportAction} commitAction={commitAssetImportAction} />
    </Page>
  );
}
