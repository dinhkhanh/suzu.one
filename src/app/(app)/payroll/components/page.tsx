import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listComponentVersions } from "@/modules/payroll/components";
import { listEntityOptions } from "@/modules/payroll/options";
import { canDecidePayRules, canProposePayRules, canReadPayRules } from "@/modules/payroll/policy";
import { formatVnd } from "@/modules/payroll/ui/money";
import { ProposeComponentForm, RuleDecisionButtons } from "@/modules/payroll/ui/rule-forms";

export const metadata: Metadata = { title: "Pay components" };

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

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1>{t("components.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("components.description")}</p>
      </header>

      {proposals.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("rules.waiting")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border">
            {proposals.map((version) => (
              <li key={version.id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
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
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("components.code")}</TableHead>
            <TableHead>{t("components.name")}</TableHead>
            <TableHead>{t("components.scope")}</TableHead>
            <TableHead>{t("components.kind")}</TableHead>
            <TableHead>{t("components.source")}</TableHead>
            <TableHead>{t("components.taxTreatment")}</TableHead>
            <TableHead>{t("components.proration")}</TableHead>
            <TableHead>{t("components.validFrom")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {approved.map((version) => {
            const inForce = version.validFrom <= today && (version.validTo === null || version.validTo >= today);
            return (
              <TableRow key={version.id} className={inForce ? undefined : "text-muted-foreground"}>
                <TableCell className="font-mono text-xs">{version.code}</TableCell>
                <TableCell>
                  {version.name}
                  {version.formula ? <code className="mt-1 block rounded bg-muted px-2 py-1 text-xs">{version.formula}</code> : null}
                </TableCell>
                <TableCell>{version.entityId ? entityCode.get(version.entityId) : t("components.groupWide")}</TableCell>
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {canPropose ? <ProposeComponentForm entities={entities} /> : null}
    </div>
  );
}
