import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { crmSettings, listStages, vatRates } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { StageForm } from "@/modules/crm/ui/config-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";

export const generateMetadata = pageTitle("crmSettings");

export default async function CrmSettingsPage() {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.settings) notFound();
  const today = todayInVietnam();
  const [t, stages, settings, vat] = await Promise.all([getTranslations("crm"), listStages(), crmSettings(today), vatRates(today)]);
  const nextOrder = (stages.at(-1)?.sortOrder ?? 0) + 10;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1>{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.intro")}</p>
      </header>
      <CrmTabs current="settings" show={shell.show} />
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("settings.stages")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border">
          {stages.map((stage) => (
            <li key={stage.id} className="p-3 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">{stage.sortOrder}</span>
                  <span className="font-medium">{stage.name}</span>
                  {stage.nameEn ? <span className="text-muted-foreground">{stage.nameEn}</span> : null}
                  <Badge variant="outline">{t(`enums.stageCategory.${stage.category as "open"}`)}</Badge>
                  <span className="text-xs text-muted-foreground">{stage.probability}%</span>
                  {stage.gates.length ? <span className="text-xs text-muted-foreground">{t("settings.needs", { gates: stage.gates.map((gate) => t(`enums.gate.${gate as "contacts"}`)).join(", ") })}</span> : null}
                  {stage.isActive ? null : <Badge variant="secondary">{t("settings.inactive")}</Badge>}
                </summary>
                <div className="pt-3">
                  <StageForm stage={stage} nextOrder={nextOrder} />
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("settings.addStage")}</summary>
          <div className="pt-3">
            <StageForm nextOrder={nextOrder} />
          </div>
        </details>
      </section>
      <section className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
        <h2 className="font-medium">{t("settings.parameters")}</h2>
        <p>{t("settings.parameterValues", { stale: settings.staleDealDays, renewal: settings.renewalLeadDays, reminders: settings.receivableReminderDays.join(", "), terms: settings.defaultPaymentTermsDays, validity: settings.quoteValidityDays, discount: settings.quoteDiscountApprovalBp / 100, margin: settings.quoteMarginFloorBp / 100 })}</p>
        <p>{t("settings.vat", { rate: vat.defaultBp / 100, allowed: vat.allowedBp.map((bp) => `${bp / 100}%`).join(", ") })}</p>
        <p className="text-muted-foreground">
          {t("settings.parametersHint")}{" "}
          <Link href="/admin/rules" className="underline">
            {t("settings.rulesLink")}
          </Link>
        </p>
      </section>
    </div>
  );
}
