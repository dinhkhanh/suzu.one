// The quote as a PDF (FR-CRM-23) on the contracting entity's letterhead, through the documents
// module's writer. Node runtime, never cached, never stored; access re-checked now — whoever may
// see the deal's value may print its quote — and every print recorded.
import { NextResponse } from "next/server";
import { getFormatter, getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import { renderDocumentPdf } from "@/modules/documents/document-pdf";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { canViewQuotes, getDeal, getQuote, loadCrm } from "@/modules/crm/service";
import { quoteDocument } from "@/modules/crm/quote-document";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/crm/deals/[dealId]/quotes/[quoteId]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { dealId, quoteId } = await context.params;
  const actor = { userId: user.userId, personId: user.person.id, email: user.email };
  const { viewer } = await loadCrm(user);
  const [found, quote] = await Promise.all([getDeal(viewer, dealId), /^[0-9a-f-]{36}$/.test(quoteId) ? getQuote(quoteId) : Promise.resolve(null)]);
  if (!found || !quote || quote.quote.dealId !== dealId || !canViewQuotes(viewer, found.facts)) {
    await recordAudit({ action: "crm.quote.pdf.denied", actor, request: user.request, resource: { type: "crm_quote", id: quoteId } });
    return new NextResponse("Not found", { status: 404 });
  }
  const [t, tDocuments, format] = await Promise.all([getTranslations("crm.quote"), getTranslations("documents"), getFormatter()]);
  const document = await quoteDocument(quote.quote, quote.lines, {
    title: t("documentTitle"),
    months: (count) => t("monthsCount", { count }),
    money: (amount) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 }),
    none: "—",
  });
  const pdf = renderDocumentPdf({ title: document.title, number: document.number, text: document.text, letterhead: document.letterhead, footer: tDocuments("pdfFooter", { number: document.number }), today: todayInVietnam() });
  await recordAudit({ action: "crm.quote.pdf", actor, request: user.request, resource: { type: "crm_quote", id: quote.quote.id, entityId: found.deal.entityId }, summary: document.number });
  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${document.number.replaceAll("/", "_").replaceAll(" ", "_")}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
