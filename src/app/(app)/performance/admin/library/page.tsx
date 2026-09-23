import { getFormatter, getTranslations } from "next-intl/server";
import { canManageKpiLibrary, isWorkMetric, listKpis } from "@/modules/performance/service";
import { bpText } from "@/modules/performance/ui/kpi";
import { KpiForm } from "@/modules/performance/ui/kpi-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("kPILibrary");

// The KPI library (FR-PRF-02) is the group's: everyone in HR reads it, group-wide HR changes it.
export default async function KpiLibraryPage() {
  const user = await requireUser();
  const manages = canManageKpiLibrary(user.principal);
  const [kpis, t, format] = await Promise.all([listKpis({ includeInactive: true }), getTranslations("performance"), getFormatter()]);
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("library.description")}</p>
      <ul className="flex flex-col divide-y rounded-xl border">
        {kpis.map((kpi) => (
          <li key={kpi.id} className="p-3 text-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`font-medium ${kpi.isActive ? "" : "text-muted-foreground line-through"}`}>{kpi.name}</span>
                <span className="text-xs text-muted-foreground">{[kpi.code, t(`kpi.unit.${kpi.unit}`), t(`kpi.direction.${kpi.direction}`), t(`kpi.frequency.${kpi.frequency}`), t("library.capFloor", { cap: bpText(format, kpi.capBp), floor: bpText(format, kpi.floorBp) }), ...(isWorkMetric(kpi.workMetric) ? [t("workMetrics.fromWork", { metric: t(`workMetrics.metrics.${kpi.workMetric}`) })] : [])].join(" · ")}</span>
              </summary>
              <div className="pt-3">{manages ? <KpiForm value={{ id: kpi.id, code: kpi.code, name: kpi.name, description: kpi.description, unit: kpi.unit, direction: kpi.direction, frequency: kpi.frequency, capBp: kpi.capBp, floorBp: kpi.floorBp, isActive: kpi.isActive, workMetric: isWorkMetric(kpi.workMetric) ? kpi.workMetric : null }} /> : <p className="text-sm text-muted-foreground">{kpi.description ?? "—"}</p>}</div>
            </details>
          </li>
        ))}
      </ul>
      {kpis.length === 0 ? <p className="text-sm text-muted-foreground">{t("library.empty")}</p> : null}
      {manages ? (
        <section className="rounded-xl border p-3">
          <h2 className="pb-3 text-sm font-medium">{t("library.new")}</h2>
          <KpiForm value={{ id: null, code: "", name: "", description: null, unit: "number", direction: "higher_better", frequency: "monthly", capBp: 12000, floorBp: 0, isActive: true }} />
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">{t("library.readOnly")}</p>
      )}
    </div>
  );
}
