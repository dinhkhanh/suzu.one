// The offer letter as a PDF (FR-REC-08). Modelled on the generated-document route, and for the
// same reasons: node runtime, never cached, never stored on disk, and the tier re-checked **now**
// inside `offerLetter`. A letter is not a key that keeps working after the lock has been changed.
//
// It also asks for a fresh proof of identity (FR-PLT-06), like the payslip route: this file is a
// salary in a downloadable form, and a forgotten open tab should not produce one.
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import { renderDocumentPdf } from "@/modules/documents/document-pdf";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { offerLetter } from "@/modules/recruit/offers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/recruit/offers/[offerId]/letter">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!isStepUpFresh(user.reauthAt)) return new NextResponse("step_up_required", { status: 403 });

  const { offerId } = await context.params;
  // null = not there, no wording on it, or not this reader's to see. The same answer either way,
  // so the refusal says nothing about whether an offer to that person exists.
  const rendered = await offerLetter({ principal: user.principal, personId: user.person.id }, offerId);
  if (!rendered) {
    await recordAudit({ action: "recruit.offer.letter.denied", actor: { userId: user.userId, personId: user.person.id, email: user.email }, request: user.request, resource: { type: "job_offer", id: offerId } });
    return new NextResponse("Not found", { status: 404 });
  }

  const t = await getTranslations("documents");
  const pdf = renderDocumentPdf({
    title: rendered.title,
    number: rendered.number,
    text: rendered.text,
    letterhead: rendered.letterhead,
    footer: t("pdfFooter", { number: rendered.number }),
    today: todayInVietnam(),
  });

  await recordAudit({
    action: "recruit.offer.letter",
    actor: { userId: user.userId, personId: user.person.id, email: user.email },
    request: user.request,
    resource: { type: "job_offer", id: offerId, entityId: rendered.offer.entityId },
    // The number and nothing else: the audit log is read far more widely than the letter.
    summary: rendered.number,
  });

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${rendered.number}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
