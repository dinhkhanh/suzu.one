import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { commitDepartmentImportAction, stageDepartmentImportAction } from "@/modules/platform/org/actions";
import { flattenTree } from "@/modules/platform/org/engine/tree";
import { departmentTemplate } from "@/modules/platform/org/import";
import { listEntities, orgUnitTree } from "@/modules/platform/org/service";
import { OrgUnitForm } from "@/modules/platform/org/ui/org-forms";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Org units" };

export default async function OrgPage() {
  const user = await requireUser();
  if (!can(user.principal, "org:read")) notFound();

  const t = await getTranslations("org");
  const [tree, entities] = await Promise.all([orgUnitTree(), listEntities()]);
  const units = flattenTree(tree);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  // A shared unit belongs to the group; an entity's own to whoever manages that entity — and a
  // grant over a unit reaches everything below it.
  const canManage = (unit: { entityId: string | null; path: readonly string[] }) => can(user.principal, "org:manage", unit.entityId ? { entityId: unit.entityId, unitPath: unit.path } : { unitPath: unit.path });
  const manageableEntities = entities.filter((entity) => can(user.principal, "org:manage", { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const canShare = can(user.principal, "org:manage", {});
  const parents = units.filter((unit) => unit.isActive).map(({ id, name, depth, path }) => ({ id, name, depth, path }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <ul className="flex flex-col gap-3">
        {units.map((unit) => {
          const manage = canManage(unit);
          return (
            <li key={unit.id} className="rounded-xl border p-4" style={{ marginInlineStart: `${unit.depth * 1.5}rem` }}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  {unit.code ? <span className="font-mono text-xs text-muted-foreground">{unit.code}</span> : null}
                  <span className="font-medium">{unit.name}</span>
                  <Badge variant="outline">{t(`kinds.${unit.kind}`)}</Badge>
                  <Badge variant="outline">{unit.entityId ? entityName.get(unit.entityId) : t("shared")}</Badge>
                  {unit.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                  {unit.children.length ? <span className="text-muted-foreground">{t("childCount", { count: unit.children.length })}</span> : null}
                </summary>
                {manage ? (
                  <div className="mt-4 flex flex-col gap-4">
                    <OrgUnitForm unit={unit} parents={parents} entities={manageableEntities} />
                    <div className="flex flex-col gap-3 border-t pt-4">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("addInside", { name: unit.name })}</h3>
                      <OrgUnitForm parents={parents} entities={manageableEntities} defaultParentId={unit.id} />
                    </div>
                  </div>
                ) : null}
              </details>
            </li>
          );
        })}
      </ul>

      {canShare || manageableEntities.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("addUnit")}</h2>
          <OrgUnitForm parents={parents} entities={manageableEntities} canShare={canShare} />
        </section>
      ) : null}

      {canShare ? <ImportWizard title={t("importTitle")} template={{ fileName: "departments.csv", csv: departmentTemplate() }} stageAction={stageDepartmentImportAction} commitAction={commitDepartmentImportAction} /> : null}
    </div>
  );
}
