// A generated document as a PDF (FR-CHR-06): the paper as it was issued (CHR-01), never a new
// rendering. Node runtime, never cached — and the tier is checked **again, now**, inside
// `openDocument`: a document is not a key that keeps working after the lock has been changed. The
// stored file opens through the files module's one-minute link, which audits the opening of a
// restricted or compensation paper as it does any other such file.
import { NextResponse } from "next/server";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { openDocument } from "@/modules/documents/service";
import { createDownloadLink } from "@/modules/platform/files/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/documents/[documentId]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { documentId } = await context.params;
  const actor = { userId: user.userId, personId: user.person.id, email: user.email };
  // null = not there, or not this reader's to see. The same answer either way, so the refusal
  // says nothing about whether a salary letter about that person exists.
  const opened = /^[0-9a-f-]{36}$/.test(documentId) ? await openDocument({ principal: user.principal, personId: user.person.id }, documentId) : null;
  if (!opened) {
    await recordAudit({ action: "document.open.denied", actor, request: user.request, resource: { type: "generated_document", id: documentId } });
    return new NextResponse("Not found", { status: 404 });
  }
  // A compensation letter opens like a payslip: only on a session that proved who it is in the last
  // few minutes (FR-PLT-06). No redirect to the sign-in page from a download — the browser would save it.
  if (opened.document.tier === "compensation" && !isStepUpFresh(user.reauthAt)) return new NextResponse("step_up_required", { status: 403 });

  const url = await createDownloadLink(opened.file, { personId: user.person.id, email: user.email }, user.request);
  await recordAudit({ action: "document.open", actor, request: user.request, resource: { type: "generated_document", id: documentId, entityId: opened.document.entityId }, summary: opened.document.number });
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
