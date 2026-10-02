import { Fragment } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Tile, TileGrid } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { BILLING_STATUSES, billingEntities, type BillingStatus, canDecideBilling, canOpenBillingQueue, listBillingQueue, openProject } from "@/modules/projects/service";
import { BillingDecisionForm, ManualBillingForm, SignedScanLink } from "@/modules/projects/ui/commercial-forms";
import { pageTitle } from "@/i18n/page-title";
import { contractNumbersOfProjects } from "@/modules/crm/service";

export const generateMetadata = pageTitle("billing");

/**
 * Finance's "ready to invoice" queue (FR-PJM-56): the items of the entities the reader holds
 * `pjm:commercial` over — cut in SQL, never filtered on screen — with job number, client, source
 * and amount. Finance invoices elsewhere and records the number and date here, or waives an item
 * with a reason, from the row's detail. Filters live in the URL (a plain GET form).
 */
export default async function BillingQueuePage({ searchParams }: PageProps<"/projects/billing">) {
  const user = await requireUser();
  if (!canOpenBillingQueue(user.principal)) notFound();
  const params = await searchParams;
  const status = (BILLING_STATUSES as readonly string[]).includes(params.status as string) || params.status === "all" ? (params.status as BillingStatus | "all") : "ready";
  const entityId = typeof params.entityId === "string" && params.entityId ? params.entityId : null;
  const [t, tAcceptance, format, entities] = await Promise.all([getTranslations("projects.billing"), getTranslations("projects.acceptance"), getFormatter(), billingEntities(user.principal)]);
  const items = await listBillingQueue(user.principal, { status, entityId: entities.some((entity) => entity.id === entityId) ? entityId : null });
  // Finance is usually on none of these projects: the name links only where the reader may open it,
  // and the acceptance an item carries opens from the item itself.
  const projectIds = [...new Set(items.map((item) => item.projectId))];
  // The contract each project is delivered under (FR-CRM-25): the reference finance invoices against.
  const contractOf = await contractNumbersOfProjects(projectIds);
  const openable = new Set((await Promise.all(projectIds.map(async (id) => ((await openProject(user, id)) ? id : null)))).filter((id) => id !== null));
  const today = todayInVietnam();
  const money = (value: number | null | undefined) => (value === null || value === undefined ? t("noAmount") : format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 }));
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
  const readyTotal = items.filter((item) => item.status === "ready").reduce((sum, item) => sum + (item.amountVnd ?? 0), 0);
  const columns = 8;

  return (
    <Page>
      <PageHeader title={t("title")} description={t("intro")} />

      <form className="toolbar" method="get">
        {entities.length > 1 ? (
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground max-md:w-[calc(50%-0.25rem)]">
            {t("entity")}
            <Select name="entityId" defaultValue={entityId ?? ""} className="md:w-48">
              <option value="">{t("allEntities")}</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground max-md:w-[calc(50%-0.25rem)]">
          {t("statusFilter")}
          <Select name="status" defaultValue={status} className="md:w-44">
            {[...BILLING_STATUSES, "all" as const].map((each) => (
              <option key={each} value={each}>
                {each === "all" ? t("allStatuses") : t(`status.${each}`)}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="outline">
          {t("filter")}
        </Button>
      </form>

      {status === "ready" && items.length ? (
        <TileGrid>
          <Tile label={t("readyTotalLabel")} value={format.number(readyTotal, { style: "currency", currency: "VND", maximumFractionDigits: 0 })} hint={t("readyTotal", { count: items.length, total: money(readyTotal) })} />
        </TileGrid>
      ) : null}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="status">{t("statusFilter")}</TableHead>
              <TableHead kind="id">{t("jobNumber")}</TableHead>
              <TableHead kind="text">{t("columns.project")}</TableHead>
              <TableHead kind="text">{t("description")}</TableHead>
              <TableHead kind="org">{t("columns.client")}</TableHead>
              <TableHead kind="id">{t("reference")}</TableHead>
              <TableHead kind="date">{t("columns.created")}</TableHead>
              <TableHead kind="money">{t("amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {items.map((item) => {
              const reference = item.reference ?? contractOf.get(item.projectId) ?? null;
              const decides = canDecideBilling(user.principal, item);
              const detail = (item.acceptanceId && decides) || item.status !== "ready" || (item.status === "ready" && decides);
              return (
                <Fragment key={item.id}>
                  <TableRow>
                    <TableCell>
                      <Badge dot variant={statusTone(item.status)}>
                        {t(`status.${item.status as "ready"}`)}
                      </Badge>
                    </TableCell>
                    <TableCell kind="id">{item.jobNumber ?? "—"}</TableCell>
                    <TableCell className="max-w-56 truncate">
                      {openable.has(item.projectId) ? (
                        <Link href={`/projects/${item.projectId}/acceptance`} className="font-medium hover:underline">
                          {item.projectName}
                        </Link>
                      ) : (
                        <span className="font-medium">{item.projectName}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal">
                      <span className="line-clamp-2">{item.description}</span>
                      <span className="block text-xs text-muted-foreground">{t(`sources.${item.source as "manual"}`)}</span>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {item.clientName ? <RecordLink kind="account" id={item.clientId}>{item.clientName}</RecordLink> : "—"}
                      {item.entityName ? (
                        <RecordLink kind="entity" id={item.entityId} className="block text-xs text-muted-foreground">
                          {item.entityName}
                        </RecordLink>
                      ) : null}
                    </TableCell>
                    <TableCell kind="id">{reference ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{format.dateTime(item.createdAt, { day: "2-digit", month: "2-digit", year: "numeric" })}</TableCell>
                    <TableCell kind="money" className={item.amountVnd === null ? "text-muted-foreground" : "font-medium"}>
                      {money(item.amountVnd)}
                    </TableCell>
                  </TableRow>
                  {detail ? (
                    <TableRow data-unnumbered="" className="hover:bg-transparent">
                      <TableCell colSpan={columns} className="h-auto py-0 whitespace-normal">
                        <div className="flex flex-col gap-3 py-3">
                          {item.acceptanceId && decides ? (
                            <p className="flex flex-wrap items-center gap-3 text-sm">
                              <a href={`/projects/${item.projectId}/acceptance/${item.acceptanceId}/pdf`} className="text-link hover:underline">
                                {tAcceptance("pdf")}
                              </a>
                              <SignedScanLink acceptanceId={item.acceptanceId} label={tAcceptance("signedScan")} />
                            </p>
                          ) : null}
                          {item.status === "invoiced" ? (
                            <p className="text-sm text-muted-foreground">
                              {t("invoicedAs", { number: item.invoiceNumber ?? "—", date: date(item.invoiceDate) })}
                              {item.decidedByName ? (
                                <>
                                  {" · "}
                                  <RecordLink kind="person" id={item.decidedByPersonId}>{item.decidedByName}</RecordLink>
                                </>
                              ) : null}
                            </p>
                          ) : null}
                          {item.status === "waived" ? (
                            <p className="text-sm text-muted-foreground">
                              {t("waivedBecause", { reason: item.waivedReason ?? "—" })}
                              {item.decidedByName ? (
                                <>
                                  {" · "}
                                  <RecordLink kind="person" id={item.decidedByPersonId}>{item.decidedByName}</RecordLink>
                                </>
                              ) : null}
                            </p>
                          ) : null}
                          {item.status === "ready" && decides ? <BillingDecisionForm itemId={item.id} needsAmount={item.amountVnd === null} today={today} invoiceIn={item.clientId ? "/crm/invoices" : undefined} /> : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
        <TableAddRow label={t("addManual")}>
          <ManualBillingForm projectId={null} />
        </TableAddRow>
      </TableCard>
    </Page>
  );
}
