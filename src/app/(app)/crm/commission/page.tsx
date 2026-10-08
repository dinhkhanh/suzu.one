import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
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
    <Page width="default">
      <PageHeader title={t("title")} description={t("intro")} />
      <CrmTabs current="commission" show={shell.show} />
      {approved.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">{t("noScheme")}</p> : null}

      <TableCard>
        <TableCardHeader
          title={t("statements")}
          count={statements.length || null}
          description={months.length ? t("monthsWith", { months: months.join(", ") }) : undefined}
          actions={
            <>
              <CommissionMonthPicker month={month} />
              {runs && approved.length ? <ComputeButton month={month} /> : null}
            </>
          }
        />
        <List>
          {statements.length === 0 ? <ListEmpty>{t("noStatements")}</ListEmpty> : null}
          {statements.map((statement) => (
            <ListItem key={statement.row.id} className="block">
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
                      <Table numbered={false}>
                        <TableHeader>
                          <TableRow>
                            <TableHead kind="date">{t("columns.received")}</TableHead>
                            <TableHead kind="id">{t("columns.invoice")}</TableHead>
                            <TableHead kind="org">{t("columns.account")}</TableHead>
                            <TableHead kind="select">{t("columns.as")}</TableHead>
                            <TableHead kind="money">{t("columns.net")}</TableHead>
                            <TableHead kind="percent">{t("columns.share")}</TableHead>
                            <TableHead kind="money">{t("columns.base")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {statement.trace.lines.map((line, index) => (
                            <TableRow key={`${line.paymentId}-${index}`}>
                              <TableCell>{f.date(line.receivedOn)}</TableCell>
                              <TableCell kind="id">{line.invoiceNumber}</TableCell>
                              <TableCell>{line.accountName}</TableCell>
                              <TableCell>{t(`earners.${line.as}`)}</TableCell>
                              <TableCell kind="money">{f.money(line.netVnd)}</TableCell>
                              <TableCell kind="percent">{rate(line.shareBp)}</TableCell>
                              <TableCell kind="money">{f.money(line.baseVnd)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
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
            </ListItem>
          ))}
        </List>
      </TableCard>

      {seesSchemes ? (
        <TableCard>
          <TableCardHeader title={t("schemes")} count={schemes.length || null} />
          <List>
            {schemes.length === 0 ? <ListEmpty>{t("noSchemes")}</ListEmpty> : null}
            {schemes.map((scheme) => (
              <ListItem key={scheme.id} className="flex-col items-stretch gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{scheme.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {scheme.entityId ? (
                      <RecordLink kind="entity" id={scheme.entityId}>
                        {entityName.get(scheme.entityId)}
                      </RecordLink>
                    ) : (
                      t("group")
                    )}
                  </span>
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
              </ListItem>
            ))}
          </List>
          {proposes ? (
            <TableAddRow label={t("proposeTitle")}>
              <CommissionSchemeForm entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))} today={today} />
            </TableAddRow>
          ) : null}
        </TableCard>
      ) : null}
    </Page>
  );
}
