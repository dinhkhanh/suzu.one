import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntities } from "@/modules/platform/org/service";
import { canDecideCommissionScheme, canProposeCommissionScheme, canRunCommission, commissionMonths, listCommissionSchemes, listCommissionStatements } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { CommissionMonthPicker, CommissionSchemeForm, ComputeButton, ConfirmStatementButton, SchemeDecision } from "@/modules/crm/ui/commission-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmCommission");

const rate = (bp: number) => `${(bp / 100).toLocaleString("vi-VN", { maximumFractionDigits: 2 })}%`;

/**
 * Sales commission (FR-CRM-45). Compensation: behind step-up, never cached. A seller reads their
 * own statements; C&B read and confirm those of the people whose pay they manage; the owner decides
 * the scheme. Nothing is worked out while no approved scheme covers the month (SRS Q29).
 */
export default async function CommissionPage({ searchParams }: PageProps<"/crm/commission">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.commission) notFound();
  requireStepUp(user, "/crm/commission");
  const params = await searchParams;
  const today = todayInVietnam();
  const month = typeof params.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : today.slice(0, 7);
  const principal = user.principal;
  const runs = canRunCommission(principal);
  const proposes = canProposeCommissionScheme(principal);
  const decides = canDecideCommissionScheme(principal);
  const seesSchemes = runs || proposes || decides;
  const [t, tStatus, f, schemes, statements, months, entities] = await Promise.all([
    getTranslations("crm.commission"),
    getTranslations("crm.enums.commissionStatus"),
    formatters(),
    listCommissionSchemes(),
    listCommissionStatements(principal, month, { withTrace: true }),
    commissionMonths(principal),
    listEntities(),
  ]);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const approved = schemes.filter((scheme) => scheme.status === "approved");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>
      <CrmTabs current="commission" show={shell.show} />
      {approved.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t("noScheme")}</p> : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto">{t("statements")}</h2>
          <CommissionMonthPicker month={month} />
          {runs && approved.length ? <ComputeButton month={month} /> : null}
        </div>
        {months.length ? <p className="text-xs text-muted-foreground">{t("monthsWith", { months: months.join(", ") })}</p> : null}
        {statements.length === 0 ? <p className="text-sm text-muted-foreground">{t("noStatements")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {statements.map((statement) => (
            <li key={statement.row.id} className="p-3 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-medium">{statement.personName}</span>
                  {statement.row.entityId ? <span className="text-xs text-muted-foreground">{entityName.get(statement.row.entityId)}</span> : null}
                  <Badge variant={statusTone(statement.row.status)}>{tStatus(statement.row.status as "draft")}</Badge>
                  <span className="ml-auto tabular-nums">{t("baseOf", { base: f.money(statement.trace?.baseVnd ?? 0) })}</span>
                  <span className="font-medium tabular-nums">{f.money(statement.amountVnd)}</span>
                </summary>
                <div className="mt-3 flex flex-col gap-3">
                  {statement.trace ? (
                    <>
                      <p className="text-xs text-muted-foreground">{t("traceScheme", { scheme: statement.trace.schemeName })}</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="text-left text-muted-foreground">
                            <tr>
                              <th className="py-1 pr-3 font-normal">{t("columns.received")}</th>
                              <th className="py-1 pr-3 font-normal">{t("columns.invoice")}</th>
                              <th className="py-1 pr-3 font-normal">{t("columns.account")}</th>
                              <th className="py-1 pr-3 font-normal">{t("columns.as")}</th>
                              <th className="py-1 pr-3 text-right font-normal">{t("columns.net")}</th>
                              <th className="py-1 pr-3 text-right font-normal">{t("columns.share")}</th>
                              <th className="py-1 text-right font-normal">{t("columns.base")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statement.trace.lines.map((line, index) => (
                              <tr key={`${line.paymentId}-${index}`} className="border-t">
                                <td className="py-1 pr-3">{f.date(line.receivedOn)}</td>
                                <td className="py-1 pr-3 font-mono">{line.invoiceNumber}</td>
                                <td className="py-1 pr-3">{line.accountName}</td>
                                <td className="py-1 pr-3">{t(`earners.${line.as}`)}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{f.money(line.netVnd)}</td>
                                <td className="py-1 pr-3 text-right tabular-nums">{rate(line.shareBp)}</td>
                                <td className="py-1 text-right tabular-nums">{f.money(line.baseVnd)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <ul className="flex flex-col gap-1 text-xs">
                        {statement.trace.bands.map((band) => (
                          <li key={band.fromVnd} className="flex flex-wrap gap-2">
                            <span className="text-muted-foreground">{band.toVnd === null ? t("bandFrom", { from: f.money(band.fromVnd) }) : t("band", { from: f.money(band.fromVnd), to: f.money(band.toVnd) })}</span>
                            <span>{t("bandLine", { base: f.money(band.baseVnd), rate: rate(band.rateBp), amount: f.money(band.amountVnd) })}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {statement.canConfirm ? <ConfirmStatementButton statementId={statement.row.id} /> : null}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      {seesSchemes ? (
        <section className="flex flex-col gap-3">
          <h2>{t("schemes")}</h2>
          {schemes.length === 0 ? <p className="text-sm text-muted-foreground">{t("noSchemes")}</p> : null}
          <ul className="flex flex-col divide-y rounded-xl border">
            {schemes.map((scheme) => (
              <li key={scheme.id} className="flex flex-col gap-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{scheme.name}</span>
                  <span className="text-xs text-muted-foreground">{scheme.entityId ? entityName.get(scheme.entityId) : t("group")}</span>
                  <Badge variant={statusTone(scheme.status)}>{tStatus(scheme.status as "draft")}</Badge>
                  <span className="text-xs text-muted-foreground">{t("validity", { from: f.date(scheme.validFrom), to: scheme.validTo ? f.date(scheme.validTo) : "…" })}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(`earners.${scheme.rule.earner}`)}
                  {scheme.rule.earner === "split" ? ` · ${t("splitLine", { owner: rate(scheme.rule.splitOwnerBp), manager: rate(10_000 - scheme.rule.splitOwnerBp) })}` : ""}
                  {" · "}
                  {scheme.rule.tiers.map((tier) => t("tierLine", { from: f.money(tier.fromVnd), rate: rate(tier.rateBp) })).join("; ")}
                </p>
                {decides && scheme.status === "proposed" ? <SchemeDecision schemeId={scheme.id} /> : null}
              </li>
            ))}
          </ul>
          {proposes ? (
            <details className="rounded-xl border p-3">
              <summary className="cursor-pointer text-sm font-medium">{t("proposeTitle")}</summary>
              <div className="mt-3">
                <CommissionSchemeForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} today={today} />
              </div>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
