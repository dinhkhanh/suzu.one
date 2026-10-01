import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { versionOn } from "@/modules/platform/statutory/engine/versions";
import { listEntityOptions } from "@/modules/payroll/options";
import { listPolicyVersions } from "@/modules/payroll/policies";
import { canDecidePayRules, canProposePayRules, canReadPayRules } from "@/modules/payroll/policy";
import { ProposePolicyForm, RuleDecisionButtons } from "@/modules/payroll/ui/rule-forms";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader } from "@/components/ui/page";

export const generateMetadata = pageTitle("payPolicy");

// Company pay rules per entity: pro-rating, union, the Simple profile's PIT, variance threshold,
// pay day. Not law (that is Admin → Statutory parameters) — the owner's choices (SRS D17).
export default async function PayPolicyPage() {
  const user = await requireUser();
  if (!canReadPayRules(user.principal)) notFound();
  requireStepUp(user, "/payroll/policy");
  const [t, format, versions, entities] = await Promise.all([getTranslations("payroll"), getFormatter(), listPolicyVersions(), listEntityOptions()]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const entityCode = new Map(entities.map((entity) => [entity.id, entity.code]));
  const groupCurrent = versionOn(versions.filter((version) => version.status === "approved" && version.entityId === null), todayInVietnam());

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <Link href="/payroll" className="text-link hover:underline">
            ← {t("title")}
          </Link>
        }
        title={t("policy.title")}
        description={t("policy.description")}
      />
      <TableCard>
        <List>
          {versions.length === 0 ? <ListEmpty>{t("policy.empty")}</ListEmpty> : null}
          {versions.map((version) => (
            <ListItem key={version.id} className="flex-wrap items-start justify-between py-3">
              <div className="flex flex-col gap-2">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {version.entityId ? entityCode.get(version.entityId) : t("policy.groupWide")} · {day(version.validFrom)}
                  {version.validTo ? ` → ${day(version.validTo)}` : ""}
                  <Badge dot variant={statusTone(version.status)}>{t(`rules.status.${version.status}`)}</Badge>
                </span>
                <dl className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-4 sm:grid-cols-[auto_1fr] gap-y-0.5 text-muted-foreground">
                  {Object.entries(version.value).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt>{t(`policy.fields.${key}` as "policy.fields.payDay")}</dt>
                      <dd className="text-foreground">{typeof value === "string" ? t(`policy.options.${key}.${value}` as "policy.options.prorationBasis.working_days") : typeof value === "boolean" ? t(value ? "policy.yes" : "policy.no") : String(value ?? "—")}</dd>
                    </div>
                  ))}
                </dl>
                {version.note ? <span className="text-muted-foreground">{version.note}</span> : null}
              </div>
              {version.status === "proposed" && canDecidePayRules(user.principal) ? <RuleDecisionButtons id={version.id} kind="policy" /> : null}
            </ListItem>
          ))}
        </List>
        {canProposePayRules(user.principal) ? (
          <TableAddRow label={t("policy.propose.title")} open={versions.length === 0}>
            <ProposePolicyForm entities={entities} current={groupCurrent?.value ?? null} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
