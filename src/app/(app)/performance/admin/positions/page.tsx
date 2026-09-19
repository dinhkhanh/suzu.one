import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { listPositions } from "@/modules/core-hr/service";
import { todayInVietnam } from "@/lib/dates";
import { canManagePositionKpis, listKpis, listPositionTemplates } from "@/modules/performance/service";
import { bpText, kpiValueText } from "@/modules/performance/ui/kpi";
import { ApplyTemplatesForm, PositionKpiForm, RemovePositionKpiButton } from "@/modules/performance/ui/kpi-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const metadata: Metadata = { title: "KPI templates" };

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
          <article key={`${template.positionId}:${template.entityId ?? ""}`} className="rounded-xl border">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
              <h2 className="text-sm font-medium">
                {template.positionName}
                <span className="pl-2 text-xs font-normal text-muted-foreground">{template.entityId ? (entityName.get(template.entityId) ?? "") : t("positions.everyEntity")}</span>
              </h2>
              <ApplyTemplatesForm positionId={template.positionId} defaultFrom={nextMonth} label={t("positions.apply")} />
            </header>
            <table className="w-full text-sm">
              <tbody>
                {template.lines.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="p-2">
                      {line.kpi.name}
                      <span className="pl-2 text-xs text-muted-foreground">{[line.kpi.code, t(`kpi.frequency.${line.kpi.frequency}`), t(`kpi.direction.${line.kpi.direction}`)].join(" · ")}</span>
                    </td>
                    <td className="p-2 text-right tabular-nums">{t("entry.target", { value: kpiValueText(format, line.kpi.unit, line.targetValue) })}</td>
                    <td className="p-2 text-right tabular-nums">
                      {line.weight}
                      <span className="pl-1 text-xs text-muted-foreground">({bpText(format, Math.round((line.weight * 10000) / template.totalWeight))})</span>
                    </td>
                    <td className="p-2 text-right">{mine ? <RemovePositionKpiButton id={line.id} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        );
      })}
      {group || manageable.length > 0 ? (
        <section className="rounded-xl border p-3">
          <h2 className="pb-3 text-sm font-medium">{t("positions.addLine")}</h2>
          <PositionKpiForm positions={positions} entities={manageable.map((entity) => ({ id: entity.id, name: entity.code }))} kpis={kpis.map((kpi) => ({ id: kpi.id, name: `${kpi.name} (${kpi.code})` }))} />
          {group ? null : <p className="pt-2 text-xs text-muted-foreground">{t("positions.entityOnly")}</p>}
        </section>
      ) : null}
    </div>
  );
}
