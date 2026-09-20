import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { listPositions } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listDepartments, listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";
import { canManageTemplates } from "@/modules/platform/tasks-engine/policy";
import { listTemplates } from "@/modules/platform/tasks-engine/service";
import { RemoveItemButton, TemplateForm, TemplateItemForm } from "@/modules/platform/tasks-engine/ui/template-forms";

export const metadata: Metadata = { title: "Checklists" };

export default async function ChecklistsPage() {
  const user = await requireUser();
  if (!canManageTemplates(user.principal)) notFound();
  const t = await getTranslations("checklists");
  const [templates, entities, departments, positions, people] = await Promise.all([listTemplates(), listEntities(), listDepartments(), listPositions(), listPersonNames()]);
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((row) => row.id === id)?.name;
  const entityOptions = entities.map((entity) => ({ id: entity.id, name: entity.shortName }));
  const options = {
    entities: entityOptions.filter((entity) => can(user.principal, "person:manage", { entityId: entity.id })),
    departments: departments.filter((department) => department.isActive).map(({ id, name }) => ({ id, name })),
    positions,
    people,
    canShare: can(user.principal, "person:manage", {}),
  };

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <ul className="flex flex-col gap-3">
        {templates.length === 0 ? <li className="text-sm text-muted-foreground">{t("empty")}</li> : null}
        {templates.map((template) => {
          const manage = canManageTemplates(user.principal, template);
          const scope = [name(entityOptions, template.entityId), name(options.departments, template.departmentId), name(positions, template.positionId)].filter(Boolean).join(" · ");
          return (
            <li key={template.id} className="rounded-xl border p-4">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">{t.has(`purpose.${template.purpose}`) ? t(`purpose.${template.purpose}` as "purpose.onboarding") : template.purpose}</Badge>
                  <span className="font-medium">{template.name}</span>
                  <span className="text-muted-foreground">{scope || t("everyone")}</span>
                  <span className="text-muted-foreground">{t("itemCount", { count: template.items.length })}</span>
                  {template.isActive ? null : <Badge variant="outline">{t("inactive")}</Badge>}
                </summary>
                <div className="mt-4 flex flex-col gap-4">
                  {manage ? <TemplateForm template={template} options={options} /> : null}
                  <ol className="flex flex-col divide-y rounded-lg border text-sm">
                    {template.items.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
                        <div className="min-w-0 flex-1">
                          <p>{item.title}</p>
                          {item.description ? <p className="text-xs text-muted-foreground">{item.description}</p> : null}
                          {item.linkUrl ? (
                            <p className="text-xs">
                              <a href={item.linkUrl} className="underline underline-offset-2">
                                {t("fields.linkUrl")}: {item.linkUrl}
                              </a>
                            </p>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {item.assigneeRule === "person" ? people.find((person) => person.id === item.assigneePersonId)?.fullName : t(`rule.${item.assigneeRule.split(":")[0]}` as "rule.subject")}
                          {" · "}
                          {t("offset", { days: item.dueOffsetDays })}
                        </span>
                        {manage ? <RemoveItemButton itemId={item.id} /> : null}
                      </li>
                    ))}
                  </ol>
                  {manage ? <TemplateItemForm templateId={template.id} people={people} nextOrder={template.items.length} /> : null}
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {options.canShare || options.entities.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{t("newTemplate")}</h2>
          <TemplateForm options={options} />
        </section>
      ) : null}
    </div>
  );
}
