import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { BILLING_STATUSES, billingEntities, type BillingStatus, canDecideBilling, canOpenBillingQueue, listBillingQueue, openProject } from "@/modules/projects/service";
import { BillingDecisionForm, ManualBillingForm, SignedScanLink } from "@/modules/projects/ui/commercial-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("billing");


/**
 * Finance's "ready to invoice" queue (FR-PJM-56): the items of the entities the reader holds
 * `pjm:commercial` over — cut in SQL, never filtered on screen — with job number, client, source
 * and amount. Finance invoices elsewhere and records the number and date here, or waives an item
 * with a reason. Filters live in the URL (a plain GET form).
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
  const openable = new Set((await Promise.all(projectIds.map(async (id) => ((await openProject(user, id)) ? id : null)))).filter((id) => id !== null));
  const today = todayInVietnam();
  const money = (value: number | null | undefined) => (value === null || value === undefined ? t("noAmount") : format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0 }));
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" }) : "—");
  const readyTotal = items.filter((item) => item.status === "ready").reduce((sum, item) => sum + (item.amountVnd ?? 0), 0);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>

      <form className="flex flex-wrap items-end gap-2" method="get">
        {entities.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("entity")}
            <Select name="entityId" defaultValue={entityId ?? ""} className="w-48">
              <option value="">{t("allEntities")}</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("statusFilter")}
          <Select name="status" defaultValue={status} className="w-40">
            {[...BILLING_STATUSES, "all" as const].map((each) => (
              <option key={each} value={each}>
                {each === "all" ? t("allStatuses") : t(`status.${each}`)}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("filter")}
        </Button>
      </form>

      {status === "ready" && items.length ? <p className="text-sm">{t("readyTotal", { count: items.length, total: money(readyTotal) })}</p> : null}
      {items.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}

      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge dot variant={statusTone(item.status)}>{t(`status.${item.status as "ready"}`)}</Badge>
              {item.jobNumber ? <span className="font-mono text-sm">{item.jobNumber}</span> : null}
              {openable.has(item.projectId) ? (
                <Link href={`/projects/${item.projectId}/acceptance`} className="font-medium hover:underline">
                  {item.projectName}
                </Link>
              ) : (
                <span className="font-medium">{item.projectName}</span>
              )}
              <span className="ml-auto text-lg font-medium">{money(item.amountVnd)}</span>
            </div>
            <p className="text-sm">
              {item.description}
              <span className="text-muted-foreground"> · {t(`sources.${item.source as "manual"}`)}</span>
            </p>
            <p className="text-xs text-muted-foreground">{[item.clientName, item.entityName, item.reference ? t("referenceValue", { reference: item.reference }) : null, format.dateTime(item.createdAt, { dateStyle: "medium" })].filter(Boolean).join(" · ")}</p>
            {item.acceptanceId && canDecideBilling(user.principal, item) ? (
              <p className="flex flex-wrap items-center gap-3 text-sm">
                <a href={`/projects/${item.projectId}/acceptance/${item.acceptanceId}/pdf`} className="underline">
                  {tAcceptance("pdf")}
                </a>
                <SignedScanLink acceptanceId={item.acceptanceId} label={tAcceptance("signedScan")} />
              </p>
            ) : null}
            {item.status === "invoiced" ? <p className="text-sm text-muted-foreground">{t("invoicedAs", { number: item.invoiceNumber ?? "—", date: date(item.invoiceDate) })}{item.decidedByName ? ` · ${item.decidedByName}` : ""}</p> : null}
            {item.status === "waived" ? <p className="text-sm text-muted-foreground">{t("waivedBecause", { reason: item.waivedReason ?? "—" })}{item.decidedByName ? ` · ${item.decidedByName}` : ""}</p> : null}
            {item.status === "ready" && canDecideBilling(user.principal, item) ? <BillingDecisionForm itemId={item.id} needsAmount={item.amountVnd === null} today={today} /> : null}
          </li>
        ))}
      </ul>

      <details className="rounded-xl border border-dashed p-4">
        <summary className="cursor-pointer text-sm font-medium">{t("addManual")}</summary>
        <div className="pt-3">
          <ManualBillingForm projectId={null} />
        </div>
      </details>
    </div>
  );
}
