import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listComponentVersions } from "@/modules/payroll/components";
import { listEntityOptions } from "@/modules/payroll/options";
import { canDecidePayRules, canProposePayRules, canReadPayRules } from "@/modules/payroll/policy";
import { voidComponentAction } from "@/modules/payroll/rule-actions";
import { formatVnd } from "@/modules/payroll/ui/money";
import { VoidVersionButton } from "@/modules/platform/statutory/ui/void-version";
import { ProposeComponentForm, RuleDecisionButtons } from "@/modules/payroll/ui/rule-forms";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("payComponents");

// The pay component catalogue (FR-PAY-02). Rules, not pay — but still behind step-up: a changed
// formula changes everybody's payslip. C&B proposes; only the owner's approval puts a version in force.
export default async function ComponentsPage() {
  const user = await requireUser();
  if (!canReadPayRules(user.principal)) notFound();
  requireStepUp(user, "/payroll/components");
  const [t, format, versions, entities] = await Promise.all([getTranslations("payroll"), getFormatter(), listComponentVersions(), listEntityOptions()]);
  const canPropose = canProposePayRules(user.principal);
  const canDecide = canDecidePayRules(user.principal);
  const today = todayInVietnam();
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });
  const entityCode = new Map(entities.map((entity) => [entity.id, entity.code]));
  const proposals = versions.filter((version) => version.status === "proposed");
  const approved = versions.filter((version) => version.status === "approved");
  const voided = versions.filter((version) => version.status === "voided");

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/payroll" className="text-link hover:underline">
            ← {t("title")}
          </Link>
        }
        title={t("components.title")}
        description={t("components.description")}
      />

      {proposals.length ? (
        <TableCard>
          <TableCardHeader title={t("rules.waiting")} count={proposals.length} />
          <List>
            {proposals.map((version) => (
              <ListItem key={version.id} className="flex-wrap items-start justify-between">
                <div className="flex flex-col gap-1">
                  <span>
                    <span className="font-mono text-xs">{version.code}</span> — {version.name} · {version.entityId ? entityCode.get(version.entityId) : t("components.groupWide")} · {day(version.validFrom)}
                  </span>
                  <span className="text-muted-foreground">
                    {t(`components.kinds.${version.kind}`)} · {t(`components.sources.${version.source}`)} · {t(`components.taxTreatments.${version.taxTreatment}`)}
                    {version.exemptCap !== null ? ` (${formatVnd(version.exemptCap)})` : ""} · {t(`components.prorations.${version.proration}`)}
                    {version.subjectToInsurance ? ` · ${t("components.subjectToInsurance")}` : ""}
                  </span>
                  {version.formula ? <code className="rounded bg-muted px-2 py-1 text-xs">{version.formula}</code> : null}
                  {version.note ? <span className="text-muted-foreground">{version.note}</span> : null}
                </div>
                {canDecide ? <RuleDecisionButtons id={version.id} kind="component" /> : null}
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("components.code")}</TableHead>
              <TableHead kind="text">{t("components.name")}</TableHead>
              <TableHead kind="org">{t("components.scope")}</TableHead>
              <TableHead kind="select">{t("components.kind")}</TableHead>
              <TableHead kind="select">{t("components.source")}</TableHead>
              <TableHead kind="select">{t("components.taxTreatment")}</TableHead>
              <TableHead kind="select">{t("components.proration")}</TableHead>
              <TableHead kind="date">{t("components.validFrom")}</TableHead>
              {canDecide ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {approved.length === 0 ? <TableEmpty>{t("components.empty")}</TableEmpty> : null}
            {approved.map((version) => {
              const inForce = version.validFrom <= today && (version.validTo === null || version.validTo >= today);
              return (
                <TableRow key={version.id} className={inForce ? undefined : "text-muted-foreground"}>
                  <TableCell kind="id">{version.code}</TableCell>
                  <TableCell>
                    {version.name}
                    {version.formula ? <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs">{version.formula}</code> : null}
                  </TableCell>
                  <TableCell>
                    {version.entityId ? (
                      <RecordLink kind="entity" id={version.entityId}>
                        {entityCode.get(version.entityId)}
                      </RecordLink>
                    ) : (
                      t("components.groupWide")
                    )}
                  </TableCell>
                  <TableCell>{t(`components.kinds.${version.kind}`)}</TableCell>
                  <TableCell>{t(`components.sources.${version.source}`)}</TableCell>
                  <TableCell>
                    {t(`components.taxTreatments.${version.taxTreatment}`)}
                    {version.exemptCap !== null ? ` (${formatVnd(version.exemptCap)})` : ""}
                    {version.subjectToInsurance ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {t("components.insurable")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{t(`components.prorations.${version.proration}`)}</TableCell>
                  <TableCell>
                    {day(version.validFrom)}
                    {version.validTo ? ` → ${day(version.validTo)}` : ""}
                  </TableCell>
                  {canDecide ? (
                    <TableCell kind="actions">
                      <VoidVersionButton action={voidComponentAction} id={version.id} title={`${version.code} — ${day(version.validFrom)}`} errorNamespace="payroll.errors" />
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {canPropose ? (
          <TableAddRow label={t("components.propose.title")} open={approved.length === 0}>
            <ProposeComponentForm entities={entities} />
          </TableAddRow>
        ) : null}
      </TableCard>

      {/* Versions taken back as wrong (PAY-13): kept, with who and why. */}
      {voided.length > 0 ? (
        <Section title={t("rules.voided.title")} count={voided.length}>
          <List>
            {voided.map((version) => (
              <ListItem key={version.id} className="flex-col items-stretch gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{version.code}</span>
                  <span className="font-medium">{version.name}</span>
                  <span className="text-muted-foreground line-through">{day(version.validFrom)}</span>
                  <Badge dot variant={statusTone(version.status)}>
                    {t("rules.status.voided")}
                  </Badge>
                </span>
                <span className="text-sm text-muted-foreground">{t("rules.voided.because", { reason: version.voidReason ?? "—" })}</span>
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}
    </Page>
  );
}
