import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { commitDepartmentImportAction, stageDepartmentImportAction } from "@/modules/platform/org/actions";
import { departmentTemplate } from "@/modules/platform/org/import";
import { listDepartments, listEntities, listTeams } from "@/modules/platform/org/service";
import { DepartmentForm, TeamForm } from "@/modules/platform/org/ui/org-forms";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Departments" };

export default async function OrgPage() {
  const user = await requireUser();
  if (!can(user.principal, "org:read")) notFound();

  const t = await getTranslations("org");
  const [departments, teams, entities] = await Promise.all([listDepartments(), listTeams(), listEntities()]);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const departmentName = new Map(departments.map((department) => [department.id, department.name]));
  // Shared departments belong to the group; an entity's own departments to whoever manages that entity.
  const canManage = (entityId: string | null) => can(user.principal, "org:manage", entityId ? { entityId } : {});
  const manageableEntities = entities.filter((entity) => canManage(entity.id)).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const parents = departments.filter((department) => department.isActive).map((department) => ({ id: department.id, name: department.name }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <ul className="flex flex-col gap-3">
        {departments.map((department) => {
          const own = teams.filter((team) => team.departmentId === department.id);
          const manage = canManage(department.entityId);
          return (
            <li key={department.id} className="rounded-xl border p-4">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{department.code}</span>
                  <span className="font-medium">{department.name}</span>
                  {department.parentId ? <span className="text-muted-foreground">⊂ {departmentName.get(department.parentId)}</span> : null}
                  <Badge variant="outline">{department.entityId ? entityName.get(department.entityId) : t("shared")}</Badge>
                  {department.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                  <span className="text-muted-foreground">{t("teamCount", { count: own.length })}</span>
                </summary>
                <div className="mt-4 flex flex-col gap-4">
                  {manage ? <DepartmentForm department={department} parents={parents} entities={manageableEntities} /> : null}
                  <div className="flex flex-col gap-3 border-t pt-4">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase">{t("teams")}</h3>
                    {own.length === 0 ? <p className="text-sm text-muted-foreground">{t("noTeams")}</p> : null}
                    {own.map((team) =>
                      manage ? (
                        <TeamForm key={team.id} departmentId={department.id} team={team} />
                      ) : (
                        <p key={team.id} className="text-sm">
                          {team.name} {team.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                        </p>
                      ),
                    )}
                    {manage ? <TeamForm departmentId={department.id} /> : null}
                  </div>
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      {canManage(null) || manageableEntities.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("addDepartment")}</h2>
          <DepartmentForm parents={parents} entities={manageableEntities} canShare={canManage(null)} />
        </section>
      ) : null}

      {canManage(null) ? (
        <ImportWizard title={t("importTitle")} template={{ fileName: "departments.csv", csv: departmentTemplate() }} stageAction={stageDepartmentImportAction} commitAction={commitDepartmentImportAction} />
      ) : null}
    </div>
  );
}
