import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Segmented } from "@/components/ui/segmented";
import { statusTone } from "@/components/ui/tone";
import { RecordLink } from "@/components/ui/record-link";
import { cn } from "cn";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { getPayslipView, listMyPayslips, recordPayslipView } from "@/modules/payroll/payslips";
import { formatVnd } from "@/modules/payroll/ui/money";
import { PayslipDetail } from "@/modules/payroll/ui/payslip-detail";
import { ClosePayslipQueryButton, PayslipQueryForm, PayslipReplyForm } from "@/modules/payroll/ui/payslip-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payslip");

/** "2026-09" → "09/2026". */
const monthLabel = (month: string) => month.split("-").reverse().join("/");

/**
 * One payslip. Self, C&B over the entity, or the owner — anyone else gets the same 404 as an id
 * that does not exist (`getPayslipView` decides; the page only reacts).
 */
export default async function PayslipPage({ params }: PageProps<"/payslips/[payslipId]">) {
  const user = await requireUser();
  const { payslipId } = await params;
  const view = await getPayslipView(user.principal, payslipId);
  if (!view) notFound();
  requireStepUp(user, `/payslips/${payslipId}`);

  // The person's own months stand beside their payslip; C&B arrives from the run and goes back to it.
  const [t, format, months] = await Promise.all([getTranslations("payroll.payslips"), getFormatter(), view.isOwner ? listMyPayslips(user.person.id) : Promise.resolve([])]);
  // Counted once the page has gone out: a courtesy, never in the way of reading the payslip.
  if (view.isOwner) after(() => recordPayslipView(payslipId, user.person.id));

  const net = formatVnd(view.result.totals.net);
  const paidDays = view.result.proration.paidDaysCenti / 100;
  const eyebrow = [t("publishedOn", { date: format.dateTime(view.payslip.publishedAt, { day: "2-digit", month: "2-digit" }) }), view.entity.code, t("paidDaysShort", { days: format.number(paidDays, { maximumFractionDigits: 2 }) })].join(" · ");
  const pdf = (
    <a href={`/payslips/${payslipId}/pdf`} className={buttonVariants()} download>
      {t("downloadPdf")}
    </a>
  );

  const body = (
    <Page width="default" className="min-w-0 flex-1">
      <PageHeader
        eyebrow={eyebrow}
        title={t("monthTitle", { month: monthLabel(view.run.month) })}
        description={view.run.kind === "off_cycle" && view.run.name ? view.run.name : undefined}
        actions={
          <>
            <span className="hidden flex-col items-end md:flex">
              <span className="section-label">{t("net")}</span>
              <span className="font-mono text-[30px] leading-none font-medium tracking-[-0.02em] tabular-nums">{net}</span>
            </span>
            {pdf}
          </>
        }
      >
        {view.isOwner ? null : (
          <Link href={`/payroll/runs/${view.run.id}`} className="text-sm text-link hover:underline">
            ← {t("backToRun")}
          </Link>
        )}
      </PageHeader>

      {/* The net, the one figure a phone opens this page for. */}
      <div className="flex flex-col gap-1 rounded-[18px] bg-ink px-5 py-4 text-ink-foreground md:hidden">
        <span className="text-xs font-medium tracking-[0.06em] uppercase opacity-70">{t("net")}</span>
        <span className="font-mono text-[34px] leading-none font-medium tracking-[-0.02em] tabular-nums">{net}</span>
        <span className="text-xs opacity-70">{view.person.fullName}</span>
      </div>

      <PayslipDetail result={view.result} componentNames={view.componentNames} person={{ ...view.person, id: view.payslip.personId }} entity={view.entity} month={view.run.month} runName={view.run.kind === "off_cycle" ? view.run.name : null} />

      <Card size="sm">
        <CardContent className="flex flex-col gap-1 text-sm">
          <span>{t("rulesNote")}</span>
          <Link href="/admin/rules" className="text-link hover:underline">
            {t("rulesLink")}
          </Link>
        </CardContent>
      </Card>

      {/* ── Questions about this payslip go to C&B (FR-PAY-32) ── */}
      <Section title={t("queries.title")} count={view.queries.length || undefined}>
        {view.queries.length === 0 ? <p className="text-sm text-muted-foreground">{t("queries.none")}</p> : null}
        {view.queries.length > 0 ? (
          <List>
            {view.queries.map(({ query, messages }) => (
              <ListItem key={query.id} className="flex-col items-stretch gap-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge dot variant={statusTone(query.status)}>{t(`queries.statuses.${query.status}`)}</Badge>
                  <span className="font-mono text-xs text-faint tabular-nums">{format.dateTime(query.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
                <ol className="flex flex-col gap-3">
                  {messages.map((message) => (
                    <li key={message.id} className="text-sm">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <RecordLink kind="person" id={message.authorPersonId} className="font-medium">
                          {message.authorName}
                        </RecordLink>
                        <span className="font-mono text-xs text-faint tabular-nums">{format.dateTime(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                      </div>
                      <RichText text={message.body} />
                    </li>
                  ))}
                </ol>
                {query.status === "closed" ? null : (
                  <div className="flex flex-col gap-2">
                    <PayslipReplyForm queryId={query.id} />
                    <ClosePayslipQueryButton queryId={query.id} />
                  </div>
                )}
              </ListItem>
            ))}
          </List>
        ) : null}
        {view.isOwner ? <PayslipQueryForm payslipId={payslipId} /> : null}
      </Section>
    </Page>
  );

  if (!view.isOwner || months.length <= 1) return body;

  // The months: a rail on a desk, a row of chips on a phone.
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-8">
      <nav aria-label={t("mine")} className="-mx-4 overflow-x-auto px-4 md:hidden" style={{ scrollbarWidth: "none" }}>
        <Segmented value={payslipId} options={months.map((row) => ({ value: row.id, label: monthLabel(row.month), href: `/payslips/${row.id}` }))} aria-label={t("mine")} />
      </nav>
      <nav aria-label={t("mine")} className="hidden w-52 shrink-0 flex-col gap-0.5 md:sticky md:top-[4.5rem] md:flex">
        <span className="section-label px-2 pb-1.5">{t("mine")}</span>
        {months.map((row) => (
          <Link key={row.id} href={`/payslips/${row.id}`} aria-current={row.id === payslipId ? "page" : undefined} className={cn("press flex h-9 items-center justify-between gap-2 rounded-[0.625rem] px-2.5 text-sm transition-colors hover:bg-canvas", row.id === payslipId ? "bg-canvas font-medium" : "text-muted-foreground")}>
            <span className="font-mono tabular-nums">{monthLabel(row.month)}</span>
            {row.firstViewedAt ? null : <span aria-hidden className="size-1.5 rounded-full bg-primary" />}
          </Link>
        ))}
      </nav>
      {body}
    </div>
  );
}
