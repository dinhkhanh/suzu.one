import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/lib/db";
import { asc } from "drizzle-orm";
import { requireUser } from "@/modules/platform/auth/session";
import { type AssetStatus, ASSET_STATUSES, canManageAssets, canReadAssetMoney, canReadRegister, listAssets, listCategories, summaryByStatus } from "@/modules/assets/service";
import { RegisterFilterBar, RegisterTable } from "@/modules/assets/ui/register-views";

export const metadata: Metadata = { title: "Tài sản" };

// The register (FR-AST-01). Someone without `asset:manage` anywhere has no register at all — only
// the equipment they are holding themselves, at /assets/mine.
export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const user = await requireUser();
  if (!canReadRegister(user.principal)) redirect("/assets/mine");

  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const status = ASSET_STATUSES.find((value) => value === one(query.status));
  const filter = { entityId: one(query.entityId), categoryId: one(query.categoryId), status: status as AssetStatus | undefined, search: one(query.search) };

  const [rows, categories, entities, totals, t] = await Promise.all([
    listAssets(user.principal, filter),
    listCategories(),
    db().select().from(schema.entity).orderBy(asc(schema.entity.code)),
    summaryByStatus(user.principal),
    getTranslations("assets"),
  ]);
  const showMoney = canReadAssetMoney(user.principal, filter.entityId);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/assets/mine" className="h-9 rounded-md border px-3 text-sm leading-9">
            {t("nav.mine")}
          </Link>
          <Link href="/assets/bookings" className="h-9 rounded-md border px-3 text-sm leading-9">
            {t("nav.bookings")}
          </Link>
          <Link href="/assets/licences" className="h-9 rounded-md border px-3 text-sm leading-9">
            {t("nav.licences")}
          </Link>
          {canManageAssets(user.principal) ? (
            <>
              <Link href="/assets/labels" className="h-9 rounded-md border px-3 text-sm leading-9">
                {t("nav.labels")}
              </Link>
              <Link href="/assets/import" className="h-9 rounded-md border px-3 text-sm leading-9">
                {t("nav.import")}
              </Link>
              <Link href="/assets/categories" className="h-9 rounded-md border px-3 text-sm leading-9">
                {t("nav.categories")}
              </Link>
              <Link href="/assets/new" className="h-9 rounded-md bg-primary px-3 text-sm font-medium leading-9 text-primary-foreground">
                {t("nav.new")}
              </Link>
            </>
          ) : null}
        </div>
      </header>

      <p className="text-sm text-muted-foreground">{t("totals", totals)}</p>
      <RegisterFilterBar query={filter} entities={entities} categories={categories} />
      <RegisterTable rows={rows} showMoney={showMoney} />
    </div>
  );
}
