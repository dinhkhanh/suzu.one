import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { findEntity, listBranches } from "@/modules/platform/org/service";
import { BranchForm, EditEntityForm } from "@/modules/platform/org/ui/entity-forms";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("entity");

export default async function EntityPage({ params }: PageProps<"/admin/entities/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [entity, allBranches, t] = await Promise.all([findEntity(id), listBranches(), getTranslations("entities")]);
  if (!entity || !can(user.principal, "org:read", { entityId: entity.id })) notFound();

  const canManage = can(user.principal, "org:manage", { entityId: entity.id });
  const branches = allBranches.filter((branch) => branch.entityId === entity.id);
  const facts: [string, string | number | null][] = [
    [t("legalName"), entity.legalName],
    [t("legalRepresentative"), entity.legalRepresentative],
    [t("taxCode"), entity.taxCode],
    [t("insuranceUnitCode"), entity.insuranceUnitCode],
    [t("wageRegion"), entity.wageRegion ? t("wageRegionValue", { region: entity.wageRegion }) : null],
    [t("address"), entity.address],
  ];

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link href="/admin/entities" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1 className="flex items-center gap-3">
          {entity.shortName}
          <span className="font-mono text-sm text-muted-foreground">{entity.code}</span>
          {entity.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
        </h1>
      </header>

      {canManage ? (
        <EditEntityForm entity={entity} />
      ) : (
        <dl className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t("branches")}</h2>
        {branches.length === 0 ? <p className="text-sm text-muted-foreground">{t("noBranches")}</p> : null}
        {canManage ? (
          <>
            {branches.map((branch) => (
              <BranchForm key={branch.id} entityId={entity.id} branch={branch} />
            ))}
            <div className="rounded-xl border p-4">
              <BranchForm entityId={entity.id} />
            </div>
          </>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {branches.map((branch) => (
              <li key={branch.id}>
                <span className="font-medium">{branch.name}</span>
                {branch.address ? <span className="text-muted-foreground"> — {branch.address}</span> : null}
                {branch.isActive ? null : <Badge variant="outline" className="ml-2">{t("inactive")}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
