import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { getPayslipView, recordPayslipView } from "@/modules/payroll/payslips";
import { PayslipDetail } from "@/modules/payroll/ui/payslip-detail";
import { ClosePayslipQueryButton, PayslipQueryForm, PayslipReplyForm } from "@/modules/payroll/ui/payslip-forms";

export const metadata: Metadata = { title: "Payslip" };

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

  const [t, format] = await Promise.all([getTranslations("payroll.payslips"), getFormatter()]);
  if (view.isOwner) await recordPayslipView(payslipId, user.person.id);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <Link href={view.isOwner ? "/payslips" : `/payroll/runs/${view.run.id}`} className="text-sm text-muted-foreground hover:underline">
          ← {view.isOwner ? t("mine") : t("backToRun")}
        </Link>
        <a href={`/payslips/${payslipId}/pdf`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" download>
          {t("downloadPdf")}
        </a>
      </header>

      <PayslipDetail result={view.result} componentNames={view.componentNames} person={view.person} entity={view.entity} month={view.run.month} runName={view.run.kind === "off_cycle" ? view.run.name : null} />

      {/* ── Questions about this payslip go to C&B (FR-PAY-32) ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("queries.title")}</h2>
        {view.queries.length === 0 ? <p className="text-sm text-muted-foreground">{t("queries.none")}</p> : null}
        {view.queries.map(({ query, messages }) => (
          <article key={query.id} className="flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={query.status === "closed" ? "secondary" : "default"}>{t(`queries.statuses.${query.status}`)}</Badge>
              <span className="text-xs text-muted-foreground">{format.dateTime(query.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
            <ol className="flex flex-col gap-3">
              {messages.map((message) => (
                <li key={message.id} className="text-sm">
                  <div className="flex flex-wrap gap-2">
                    <span className="font-medium">{message.authorName}</span>
                    <span className="text-xs text-muted-foreground">{format.dateTime(message.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{message.body}</p>
                </li>
              ))}
            </ol>
            {query.status === "closed" ? null : (
              <div className="flex flex-col gap-2">
                <PayslipReplyForm queryId={query.id} />
                <ClosePayslipQueryButton queryId={query.id} />
              </div>
            )}
          </article>
        ))}
        {view.isOwner ? <PayslipQueryForm payslipId={payslipId} /> : null}
      </section>
    </div>
  );
}
