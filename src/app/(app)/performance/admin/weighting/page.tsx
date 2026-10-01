import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { TableAddRow, TableCard, TableCardHeader } from "@/components/ui/table";
import { canDecidePerformanceRules, canProposeWeighting, DEFAULT_PERFORMANCE_WEIGHTING, listWeightingVersions, performanceWeightingSchema } from "@/modules/performance/service";
import { percentText } from "@/modules/performance/ui/result";
import { DecideWeightingForm, WeightingForm } from "@/modules/performance/ui/result-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("resultWeighting");

/**
 * FR-PRF-09's weighting as configuration (SRS Q14): HR proposes a version from a date, the owner
 * decides it, approved versions never overlap. A year's result is combined by the version in
 * force on 31 December of that year — so a rule approved later never moves a figure already paid.
 */
export default async function WeightingPage() {
  const user = await requireUser();
  const mayPropose = canProposeWeighting(user.principal);
  const mayDecide = canDecidePerformanceRules(user.principal);
  if (!mayPropose && !mayDecide) notFound();

  const [versions, entities, t, format, locale] = await Promise.all([listWeightingVersions(), listEntities(), getTranslations("performance.results"), getFormatter(), getLocale()]);
  const nameOf = (entityId: string | null) => (entityId ? (entities.find((row) => row.id === entityId)?.shortName ?? "—") : t("weighting.wholeGroup"));
  // The newest approved version is the sensible starting point for the next proposal.
  const latest = versions.find((row) => row.status === "approved");
  const start = performanceWeightingSchema.safeParse(latest?.value).data ?? DEFAULT_PERFORMANCE_WEIGHTING;
  const formatDate = (value: string) => format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium" });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2>{t("weighting.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("weighting.description")}</p>
      </section>

      <TableCard>
        <TableCardHeader title={t("weighting.versions")} count={versions.length || null} />
        <List>
          {versions.length === 0 ? <ListEmpty>{t("weighting.none")}</ListEmpty> : null}
          {versions.map((version) => {
            const value = performanceWeightingSchema.safeParse(version.value).data;
            return (
              <ListItem key={version.id} className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{nameOf(version.entityId)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("weighting.validFrom")} {formatDate(version.validFrom)}
                    {version.validTo ? ` · ${t("weighting.validTo")} ${formatDate(version.validTo)}` : ""}
                  </span>
                  <span className="text-xs">{t(`weighting.status.${version.status as "proposed" | "approved" | "rejected"}`)}</span>
                  {version.note ? <span className="text-xs text-muted-foreground">{version.note}</span> : null}
                </div>
                {value ? (
                  <>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t("weighting.review")} {percentText(format, value.reviewBp)} · {t("weighting.kpi")} {percentText(format, value.kpiBp)} · {t("weighting.okr")} {percentText(format, value.okrBp)}
                      {" · "}
                      {t("weighting.okrMix")}: {t("weighting.individual")} {percentText(format, value.okrMix.individualBp)}, {t("weighting.department")} {percentText(format, value.okrMix.departmentBp)}, {t("weighting.entityLevel")}{" "}
                      {percentText(format, value.okrMix.entityBp)}, {t("weighting.group")} {percentText(format, value.okrMix.groupBp)}
                    </p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {[...value.bands]
                        .sort((a, b) => a.minScoreBp - b.minScoreBp)
                        .map((band) => (
                          <li key={band.key} className="tabular-nums">
                            <span className="font-medium text-foreground">{locale.startsWith("en") && band.labelEn ? band.labelEn : band.label}</span> ≥ {percentText(format, band.minScoreBp)} → {percentText(format, band.multiplierBp)}
                          </li>
                        ))}
                    </ul>
                  </>
                ) : null}
                {mayDecide && version.status === "proposed" ? <DecideWeightingForm id={version.id} /> : null}
              </ListItem>
            );
          })}
        </List>
        {mayPropose ? (
          <TableAddRow label={t("weighting.propose")} open={versions.length === 0}>
            <WeightingForm entities={entities.map((row) => ({ id: row.id, name: row.shortName }))} start={start} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </div>
  );
}
