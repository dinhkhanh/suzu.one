// The onboarding and offboarding checklists (FR-CHR-10, 11): HR's templates whose steps become
// assigned, dated tasks when someone joins or leaves. A server component — the forms inside are
// the client parts. Shown on the checklists page beside the library, to HR only.
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { listPositions } from "../service";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { canManageTemplates } from "@/modules/platform/tasks-engine/policy";
import { listTemplates } from "@/modules/platform/tasks-engine/service";
import { RemoveItemButton, TemplateForm, TemplateItemForm } from "@/modules/platform/tasks-engine/ui/template-forms";

export async function LifecycleTemplates({ principal }: { principal: Principal }) {
  const t = await getTranslations("checklists");
  const [templates, entities, departments, positions, people] = await Promise.all([listTemplates(), listEntities(), unitChoices(), listPositions(), listPersonNames()]);
  const name = (list: { id: string; name: string }[], id: string | null) => list.find((row) => row.id === id)?.name;
  const entityOptions = entities.map((entity) => ({ id: entity.id, name: entity.shortName }));
  const options = {
    entities: entityOptions.filter((entity) => can(principal, "person:manage", { entityId: entity.id })),
    departments,
    positions,
    people,
    canShare: can(principal, "person:manage", {}),
  };

  return (
    <TableCard>
      <List>
        {templates.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
        {templates.map((template) => {
          const manage = canManageTemplates(principal, template);
          const scope = [name(entityOptions, template.entityId), name(options.departments, template.departmentId), name(positions, template.positionId)].filter(Boolean).join(" · ");
          return (
            <ListItem key={template.id} className="block">
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
                  <TableCard>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead kind="text">{t("fields.title")}</TableHead>
                          <TableHead kind="person">{t("fields.rule")}</TableHead>
                          <TableHead kind="date">{t("columns.due")}</TableHead>
                          {manage ? <TableHead kind="actions" /> : null}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {template.items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="min-w-56 whitespace-normal">
                              <p>{item.title}</p>
                              {item.description ? <p className="text-xs text-muted-foreground">{item.description}</p> : null}
                              {item.linkUrl ? (
                                <p className="text-xs">
                                  <a href={item.linkUrl} className="underline underline-offset-2">
                                    {t("fields.linkUrl")}: {item.linkUrl}
                                  </a>
                                </p>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              {item.assigneeRule === "person" ? (
                                <RecordLink kind="person" id={item.assigneePersonId}>
                                  {people.find((person) => person.id === item.assigneePersonId)?.fullName}
                                </RecordLink>
                              ) : (
                                t(`rule.${item.assigneeRule.split(":")[0]}` as "rule.subject")
                              )}
                            </TableCell>
                            <TableCell>{t("offset", { days: item.dueOffsetDays })}</TableCell>
                            {manage ? (
                              <TableCell kind="actions">
                                <RemoveItemButton itemId={item.id} />
                              </TableCell>
                            ) : null}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {manage ? (
                      <TableAddRow label={t("addItem")}>
                        <div className="[&>form]:border-t-0 [&>form]:pt-0">
                          <TemplateItemForm templateId={template.id} people={people} nextOrder={template.items.length} />
                        </div>
                      </TableAddRow>
                    ) : null}
                  </TableCard>
                </div>
              </details>
            </ListItem>
          );
        })}
      </List>
      {options.canShare || options.entities.length > 0 ? (
        <TableAddRow label={t("newTemplate")} open={templates.length === 0}>
          <TemplateForm options={options} />
        </TableAddRow>
      ) : null}
    </TableCard>
  );
}
