// A generated document as a PDF (FR-CHR-06). Modelled on the payslip route: node runtime, never
// cached, never stored on disk — and the tier is checked **again, now**, inside `openDocument`.
// A document is not a key that keeps working after the lock has been changed.
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { documentsToday, openDocument } from "@/modules/documents/service";
import { renderDocumentPdf } from "@/modules/documents/document-pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/documents/[documentId]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { documentId } = await context.params;
  // null = not there, or not this reader's to see. The same answer either way, so the refusal
  // says nothing about whether a salary letter about that person exists.
  const rendered = await openDocument({ principal: user.principal, personId: user.person.id }, documentId);
  if (!rendered) {
    await recordAudit({ action: "document.open.denied", actor: { userId: user.userId, personId: user.person.id, email: user.email }, request: user.request, resource: { type: "generated_document", id: documentId } });
    return new NextResponse("Not found", { status: 404 });
  }
  // A compensation letter opens like a payslip: only on a session that proved who it is in the last
  // few minutes (FR-PLT-06). No redirect from a download — the browser would save the sign-in page.
  if (rendered.tier === "compensation" && !isStepUpFresh(user.reauthAt)) return new NextResponse("step_up_required", { status: 403 });

  const t = await getTranslations("documents");
  const pdf = renderDocumentPdf({
    title: rendered.title,
    number: rendered.number,
    text: rendered.text,
    letterhead: rendered.letterhead,
    footer: t("pdfFooter", { number: rendered.number }),
    today: documentsToday(),
  });

  await recordAudit({
    action: "document.open",
    actor: { userId: user.userId, personId: user.person.id, email: user.email },
    request: user.request,
    resource: { type: "generated_document", id: documentId },
    summary: rendered.number,
  });

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${rendered.number}.pdf"`,
      // A contract carries a salary: never in a shared cache, never on disk.
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
