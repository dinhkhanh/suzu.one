import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { getRequest } from "@/modules/platform/approvals/service";
import { DecisionForm } from "@/modules/platform/approvals/ui/decision-form";
import { requireUser } from "@/modules/platform/auth/session";
import { canEditQuotes, canSeeQuoteMargin, canViewQuotes, estimateMargin, getDeal, getQuote, getRateCard, priceOn, quoteApprovalReasons, quoteRequestType, vatRates } from "@/modules/crm/service";
import { lineNet, quoteNext } from "@/modules/crm/engine/quote";
import { decideQuoteAction } from "@/modules/crm/quote-actions";
import { crmShell } from "@/modules/crm/pages";
import { QuoteEditor, QuoteSteps } from "@/modules/crm/ui/quote-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmQuote");

export default async function QuotePage({ params }: PageProps<"/crm/deals/[dealId]/quotes/[quoteId]">) {
  const user = await requireUser();
  const { dealId, quoteId } = await params;
  const shell = await crmShell(user);
  const [found, quote] = await Promise.all([getDeal(shell.viewer, dealId), getQuote(quoteId)]);
  if (!found || !quote || quote.quote.dealId !== dealId || !canViewQuotes(shell.viewer, found.facts)) notFound();
  const today = todayInVietnam();
  const edits = canEditQuotes(shell.viewer, found.facts);
  const seesMargin = canSeeQuoteMargin(shell.viewer, found.facts);
  const draft = quote.quote.status === "draft";
  const [t, f, card, vat, request, reasons, margin] = await Promise.all([
    getTranslations("crm"),
    formatters(),
    edits && draft ? getRateCard() : Promise.resolve(null),
    vatRates(today),
    quote.quote.approvalRequestId ? getRequest({ personId: user.person.id, principal: user.principal }, quoteRequestType, quote.quote.approvalRequestId) : Promise.resolve(null),
    edits && draft && quote.lines.length ? quoteApprovalReasons(quote.quote, quote.lines, today) : Promise.resolve([]),
    seesMargin ? estimateMargin(quote.quote, quote.lines, today) : Promise.resolve(null),
  ]);
  const services = card
    ? card.services
        .filter((service) => service.isActive)
        .map((service) => ({ id: service.id, code: service.code, name: service.name, unit: service.unit, isRecurring: service.isRecurring, format: service.format, channel: service.channel, priceVnd: priceOn(card, service.id, found.deal.entityId, today), roleMinutes: service.roleMinutes }))
    : [];
  // What may happen next: the steps the status allows, of which a draft needing approval may only be submitted.
  const steps = edits ? quoteNext(quote.quote.status).filter((step) => !(draft && step === "send" && reasons.length > 0) && !(draft && step === "submit" && reasons.length === 0) && !(found.deal.status !== "open" && step === "revise")) : [];
  // Why approval is asked: the discount is plain to see; the margin is named only to a reader of margins.
  const visibleReasons = reasons.filter((reason) => reason === "discount" || seesMargin);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href={`/crm/deals/${dealId}`} className="underline">
            {found.deal.title}
          </Link>{" "}
          · {found.account.client.name}
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          {quote.quote.number} v{quote.quote.version}
          <Badge dot variant={statusTone(quote.quote.status === "in_approval" ? "pending" : quote.quote.status)}>
            {t(`enums.quoteStatus.${quote.quote.status as "draft"}`)}
          </Badge>
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("quote.totalIs", { total: f.money(quote.quote.totalVnd), valid: f.date(quote.quote.validUntil) })}
          {quote.quote.sentAt ? ` · ${t("quote.sentOn", { date: f.when(quote.quote.sentAt) })}` : ""}
        </p>
        {quote.quote.decisionNote ? <p className="text-sm">{t("quote.noteIs", { note: quote.quote.decisionNote })}</p> : null}
        <p className="text-sm">
          <a href={`/crm/deals/${dealId}/quotes/${quoteId}/pdf`} className="underline">
            {t("quote.pdf")}
          </a>
        </p>
      </header>
      <CrmTabs current="deals" show={shell.show} />

      {request?.canDecide ? (
        <section className="flex flex-col gap-2 rounded-xl border border-amber-300 p-4">
          <h2 className="text-sm font-medium">{t("quote.decide")}</h2>
          <p className="text-sm text-muted-foreground">{t("quote.approvalReasons", { reasons: ((request.request.payload as { reasons?: string[] }).reasons ?? []).filter((reason) => reason === "discount" || seesMargin).map((reason) => t(`enums.approvalReason.${reason as "discount"}`)).join(", ") || "—" })}</p>
          <DecisionForm requestId={request.request.id} action={decideQuoteAction} />
        </section>
      ) : null}

      {margin ? (
        <section className="rounded-xl border p-3 text-sm">
          {t("quote.margin", { hours: f.hours(margin.minutes), cost: f.money(margin.costVnd), margin: f.money(margin.marginVnd), percent: margin.marginBp === null ? "—" : `${margin.marginBp / 100}%` })}
        </section>
      ) : seesMargin ? (
        <p className="text-xs text-muted-foreground">{t("quote.noMargin")}</p>
      ) : null}

      {steps.length ? (
        <section className="flex flex-col gap-2">
          {draft && reasons.length ? <p className="text-sm text-amber-700 dark:text-amber-400">{t("quote.needsApproval", { reasons: visibleReasons.map((reason) => t(`enums.approvalReason.${reason}`)).join(", ") || t("quote.policy") })}</p> : null}
          <QuoteSteps quoteId={quoteId} dealId={dealId} steps={steps} />
        </section>
      ) : null}

      {edits && draft ? (
        <QuoteEditor quoteId={quoteId} quote={quote.quote} lines={quote.lines} services={services} vatRates={vat.allowedBp} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("quote.lineTitle")}</TableHead>
              <TableHead kind="number">{t("quote.quantity")}</TableHead>
              <TableHead kind="money">{t("quote.unitPrice")}</TableHead>
              <TableHead kind="number">{t("quote.months")}</TableHead>
              <TableHead kind="percent">{t("quote.discount")}</TableHead>
              <TableHead kind="money">{t("quote.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quote.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  {line.title}
                  {line.description ? <p className="text-xs text-muted-foreground">{line.description}</p> : null}
                </TableCell>
                <TableCell kind="number">
                  {line.quantity} {line.unit ?? ""}
                </TableCell>
                <TableCell kind="money">{f.money(line.unitPriceVnd)}</TableCell>
                <TableCell kind="number">{line.months ?? "—"}</TableCell>
                <TableCell kind="percent">{line.discountBp ? `${line.discountBp / 100}%` : "—"}</TableCell>
                <TableCell kind="money">{f.money(lineNet(line))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={5} className="text-right font-normal text-muted-foreground">
                {t("quote.vatAmount")} ({quote.quote.vatRateBp / 100}%)
              </TableCell>
              <TableCell kind="money">{f.money(quote.quote.vatVnd)}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={5} className="text-right font-medium">
                {t("quote.total")}
              </TableCell>
              <TableCell kind="money">{f.money(quote.quote.totalVnd)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
