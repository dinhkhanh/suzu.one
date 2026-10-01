import { getFormatter, getTranslations } from "next-intl/server";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPositions } from "@/modules/core-hr/service";
import { todayInVietnam } from "@/lib/dates";
import { canManagePositionKpis, listKpis, listPositionTemplates } from "@/modules/performance/service";
import { bpText, kpiValueText } from "@/modules/performance/ui/kpi";
import { ApplyTemplatesForm, PositionKpiForm, RemovePositionKpiButton } from "@/modules/performance/ui/kpi-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("kPITemplates");

// What each position is measured on (FR-PRF-02): weights with their share, targets, and "apply to
// the holders" — which never touches a KPI someone already carries.
export default async function PositionKpisPage() {
  const user = await requireUser();
  const [templates, kpis, positions, entities, t, format] = await Promise.all([listPositionTemplates(), listKpis(), listPositions(), listEntities(), getTranslations("performance"), getFormatter()]);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.code]));
  const manageable = entities.filter((entity) => entity.isActive && canManagePositionKpis(user.principal, entity.id));
  const group = canManagePositionKpis(user.principal, null);
  const nextMonth = todayInVietnam().slice(0, 7);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("positions.description")}</p>
      {templates.length === 0 ? <p className="text-sm text-muted-foreground">{t("positions.empty")}</p> : null}
      {templates.map((template) => {
        const mine = canManagePositionKpis(user.principal, template.entityId);
        return (
          <TableCard key={`${template.positionId}:${template.entityId ?? ""}`}>
            <TableCardHeader title={template.positionName} count={template.entityId ? (entityName.get(template.entityId) ?? "") : t("positions.everyEntity")} actions={<ApplyTemplatesForm positionId={template.positionId} defaultFrom={nextMonth} label={t("positions.apply")} />} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="text">{t("positions.kpi")}</TableHead>
                  <TableHead kind="id">{t("library.code")}</TableHead>
                  <TableHead kind="select">{t("library.frequency")}</TableHead>
                  <TableHead kind="select">{t("library.direction")}</TableHead>
                  <TableHead kind="number">{t("positions.target")}</TableHead>
                  <TableHead kind="number">{t("positions.weight")}</TableHead>
                  <TableHead kind="actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {template.lines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium">{line.kpi.name}</TableCell>
                    <TableCell kind="id">{line.kpi.code}</TableCell>
                    <TableCell>{t(`kpi.frequency.${line.kpi.frequency}`)}</TableCell>
                    <TableCell>{t(`kpi.direction.${line.kpi.direction}`)}</TableCell>
                    <TableCell kind="number">{kpiValueText(format, line.kpi.unit, line.targetValue)}</TableCell>
                    <TableCell kind="number">
                      {line.weight}
                      <span className="pl-1 text-xs text-muted-foreground">({bpText(format, Math.round((line.weight * 10000) / template.totalWeight))})</span>
                    </TableCell>
                    <TableCell kind="actions">{mine ? <RemovePositionKpiButton id={line.id} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        );
      })}
      {group || manageable.length > 0 ? (
        <section className="rounded-xl border p-3">
          <h2 className="pb-3 text-sm font-medium">{t("positions.addLine")}</h2>
          <PositionKpiForm positions={positions} entities={manageable.map((entity) => ({ id: entity.id, name: entity.code }))} kpis={kpis.map((kpi) => ({ id: kpi.id, name: `${kpi.name} (${kpi.code})`, unit: kpi.unit }))} />
          {group ? null : <p className="pt-2 text-xs text-muted-foreground">{t("positions.entityOnly")}</p>}
        </section>
      ) : null}
    </div>
  );
}
