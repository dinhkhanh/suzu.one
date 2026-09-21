import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { versionOn } from "@/modules/platform/statutory/engine/versions";
import { listEntityOptions } from "@/modules/payroll/options";
import { canDecidePayRules, canProposePayRules, canReadPayRules } from "@/modules/payroll/policy";
import { DEFAULT_BONUS_SCHEME, listBonusSchemeVersions } from "@/modules/payroll/service";
import { ProposeSchemeForm, SchemeDecisionButtons } from "@/modules/payroll/ui/bonus-forms";

export const metadata: Metadata = { title: "Bonus scheme" };

const percent = (bp: number): string => `${(bp / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} %`;
const factor = (bp: number): string => `× ${(bp / 10_000).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * The year-end bonus formula as versioned configuration (FR-PAY-21, SRS Q14): C&B proposes,
 * the owner decides, approved versions never overlap. Nothing about the formula is in code.
 */
export default async function BonusSchemePage() {
  const user = await requireUser();
  if (!canReadPayRules(user.principal)) notFound();
  requireStepUp(user, "/payroll/bonus/scheme");

  const [t, versions, entities] = await Promise.all([getTranslations("payroll.bonus"), listBonusSchemeVersions(), listEntityOptions()]);
  const entityCode = new Map(entities.map((entity) => [entity.id, entity.code]));
  const groupCurrent = versionOn(versions.filter((version) => version.status === "approved" && version.entityId === null), todayInVietnam());

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header>
        <Link href="/payroll/bonus" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1>{t("scheme.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("scheme.description")}</p>
      </header>

      <ul className="flex flex-col gap-3">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-4 text-sm">
            <div className="flex flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {version.entityId ? entityCode.get(version.entityId) : t("scheme.groupWide")} · {version.validFrom}
                {version.validTo ? ` → ${version.validTo}` : ""}
                <Badge variant={version.status === "approved" ? "secondary" : "outline"}>{t(`scheme.status.${version.status}`)}</Badge>
              </span>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-muted-foreground">
                <dt>{t("scheme.payComponent")}</dt>
                <dd className="text-foreground">{version.value.payComponentCode}</dd>
                <dt>{t("scheme.base")}</dt>
                <dd className="text-foreground">{version.value.baseComponentCode}</dd>
                <dt>{t("scheme.cap")}</dt>
                <dd className="text-foreground">{factor(version.value.capMultiplierBp)}</dd>
                <dt>{t("scheme.rounding")}</dt>
                <dd className="text-foreground">{version.value.roundingVnd.toLocaleString("vi-VN")} đ</dd>
                <dt>{t("scheme.serviceBands")}</dt>
                <dd className="text-foreground">{version.value.serviceBands.map((band) => `${band.label} ${factor(band.factorBp)}`).join(" · ")}</dd>
                <dt>{t("scheme.performanceBands")}</dt>
                <dd className="text-foreground">{t(`scheme.source.${version.value.performanceMultiplier.source}`)} — {version.value.performanceMultiplier.bands.map((band) => `${band.label} ≥ ${percent(band.minScoreBp)} ${factor(band.multiplierBp)}`).join(" · ")}</dd>
                <dt>{t("scheme.unitOkr")}</dt>
                <dd className="text-foreground">{version.value.unitOkr.level} — {version.value.unitOkr.bands.map((band) => `${band.label} ≥ ${percent(band.minProgressBp)} ${factor(band.multiplierBp)}`).join(" · ")}</dd>
                <dt>{t("scheme.eligibility")}</dt>
                <dd className="text-foreground">{t("scheme.eligibilityValue", { months: version.value.eligibility.minServiceMonths, excluded: version.value.eligibility.excludeWorkforceTypes.join(", ") || "—" })}</dd>
              </dl>
              {version.note ? <span className="text-muted-foreground">{version.note}</span> : null}
            </div>
            {version.status === "proposed" && canDecidePayRules(user.principal) ? <SchemeDecisionButtons id={version.id} /> : null}
          </li>
        ))}
      </ul>
      {versions.length === 0 ? <p className="text-sm text-muted-foreground">{t("scheme.empty")}</p> : null}

      {canProposePayRules(user.principal) ? <ProposeSchemeForm entities={entities} current={groupCurrent?.value ?? DEFAULT_BONUS_SCHEME} /> : null}
    </div>
  );
}
