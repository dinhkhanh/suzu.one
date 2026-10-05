// The biên bản nghiệm thu as a PDF (FR-PJM-55), on the documents module's writer and the entity's
// letterhead. Modelled on the generated-document route: node runtime, never cached, and access
// re-checked now — whoever may open the project's plan may print its paper. Nothing on it is
// money, so no fresh proof of identity is asked for.
//
// A draft is rendered here, from the template as it stands. A sent or signed record is not: the
// paper that was issued was stored when it was sent, and that file is what opens — through the
// files module's short-lived link — so an edit of the template never rewrites a paper a client holds.
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import { renderDocumentPdf } from "@/modules/documents/document-pdf";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { createDownloadLink } from "@/modules/platform/files/service";
import { acceptanceDocument, billingItemForAcceptance, findAcceptance, issuedPaper, openProject } from "@/modules/projects/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/projects/[projectId]/acceptance/[acceptanceId]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { projectId, acceptanceId } = await context.params;
  const project = await openProject(user, projectId);
  // Finance opens it through the billing item it raised, without being on the project.
  const billed = project || !/^[0-9a-f-]{36}$/.test(acceptanceId) ? null : await billingItemForAcceptance(user.principal, acceptanceId);
  const acceptance = project || billed ? await findAcceptance(acceptanceId).catch(() => undefined) : undefined;
  // Not there, void, of another project, or not this reader's to see: one answer.
  if ((!project && billed?.projectId !== projectId) || !acceptance || acceptance.projectId !== projectId || acceptance.status === "void") {
    await recordAudit({ action: "projects.acceptance.pdf.denied", actor: { userId: user.userId, personId: user.person.id, email: user.email }, request: user.request, resource: { type: "project_acceptance", id: acceptanceId } });
    return new NextResponse("Not found", { status: 404 });
  }

  const actor = { userId: user.userId, personId: user.person.id, email: user.email };
  const entityId = project?.project.entityId ?? billed?.entityId ?? null;
  if (acceptance.status !== "draft") {
    // Sent or signed: the stored paper, never a new rendering. (One sent before papers were kept is issued on this first opening.)
    const paper = await issuedPaper(acceptance);
    if (!paper) {
      await recordAudit({ action: "projects.acceptance.pdf.missing", actor, request: user.request, resource: { type: "project_acceptance", id: acceptance.id, entityId } });
      return new NextResponse("Not found", { status: 404 });
    }
    const url = await createDownloadLink(paper, { personId: user.person.id, email: user.email }, user.request);
    await recordAudit({ action: "projects.acceptance.pdf", actor, request: user.request, resource: { type: "project_acceptance", id: acceptance.id, entityId }, summary: paper.fileName });
    return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }

  const [t, tDocuments] = await Promise.all([getTranslations("projects.acceptance"), getTranslations("documents")]);
  const document = await acceptanceDocument(acceptance, {
    title: t("documentTitle"),
    scope: { milestone: t("scopes.milestone"), retainer_period: t("scopes.retainer_period"), project: t("scopes.project") },
    promised: t("promised"),
    delivered: t("delivered"),
    accepted: t("accepted"),
    totals: (totals) => t("totals", totals),
    described: t("described"),
  });
  const pdf = renderDocumentPdf({ title: document.title, number: document.number, text: document.text, letterhead: document.letterhead, footer: tDocuments("pdfFooter", { number: document.number }), today: todayInVietnam() });

  await recordAudit({ action: "projects.acceptance.pdf", actor, request: user.request, resource: { type: "project_acceptance", id: acceptance.id, entityId }, summary: document.number });

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${document.number.replaceAll("/", "_")}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
