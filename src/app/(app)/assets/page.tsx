import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Tile, TileGrid } from "@/components/ui/page";
import { Pager, readPage } from "@/components/ui/pager";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { exportAssetsAction } from "@/modules/assets/export-actions";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { listEntities } from "@/modules/platform/org/service";
import { type AssetStatus, ASSET_STATUSES, canManageAssets, canReadAssetMoney, canReadRegister, listAssetPage, listCategories, summaryByStatus } from "@/modules/assets/service";
import { AssetsNav } from "@/modules/assets/ui/nav";
import { RegisterFilterBar, RegisterTable } from "@/modules/assets/ui/register-views";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("assets");

/** Assets per page of the register (PERF-03). */
const PAGE_SIZE = 100;

// The register (FR-AST-01). Someone without `asset:manage` anywhere has no register at all — only
// the equipment they are holding themselves, at /assets/mine.
export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const user = await requireUser();
  if (!canReadRegister(user.principal)) redirect("/assets/mine");

  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const status = ASSET_STATUSES.find((value) => value === one(query.status));
  const filter = { entityId: one(query.entityId), categoryId: one(query.categoryId), status: status as AssetStatus | undefined, search: one(query.search) };
  const page = readPage(one(query.page));
  // The pages carry the filters along.
  const pageHref = (to: number) => {
    const params = new URLSearchParams(Object.entries({ ...filter, page: to > 1 ? String(to) : undefined }).filter((entry): entry is [string, string] => !!entry[1]));
    return params.size ? `/assets?${params.toString()}` : "/assets";
  };

  const [{ rows, total }, categories, entities, totals, t, tStatus, te, locale] = await Promise.all([
    listAssetPage(user.principal, filter, page, PAGE_SIZE),
    listCategories(),
    listEntities(),
    summaryByStatus(user.principal),
    getTranslations("assets"),
    getTranslations("assets.enums.status"),
    getTranslations("exports"),
    getLocale(),
  ]);
  const showMoney = canReadAssetMoney(user.principal, filter.entityId);
  const manages = canManageAssets(user.principal);

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          manages ? (
            <>
              <ExportButton action={exportAssetsAction} input={{ ...filter, locale }} label={te("button")} failedLabel={te("failed")} truncatedLabel={te("truncated")} />
              <Button nativeButton={false} variant="outline" render={<Link href="/assets/labels" />}>
                {t("nav.labels")}
              </Button>
              <Button nativeButton={false} variant="outline" render={<Link href="/assets/import" />}>
                {t("nav.import")}
              </Button>
              <Button nativeButton={false} render={<Link href="/assets/new" />}>{t("nav.new")}</Button>
            </>
          ) : null
        }
      />
      <AssetsNav current="register" manages={manages} />

      {/* The register by status, counted over everything in reach — not the page of rows below. */}
      <TileGrid>
        {ASSET_STATUSES.map((value) => (
          <Tile key={value} label={tStatus(value)} value={totals[value]} href={`/assets?status=${value}`} tone={value === "lost" && totals.lost > 0 ? "destructive" : value === "in_repair" && totals.in_repair > 0 ? "warning" : undefined} />
        ))}
      </TileGrid>

      <RegisterFilterBar query={filter} entities={entities} categories={categories} />
      <TableCard>
        <RegisterTable rows={rows} showMoney={showMoney} numberFrom={(page - 1) * PAGE_SIZE + 1} />
        {manages ? <TableAddRow label={t("nav.new")} href="/assets/new" /> : null}
      </TableCard>
      <Pager page={page} pageSize={PAGE_SIZE} total={total} href={pageHref} />
    </Page>
  );
}
