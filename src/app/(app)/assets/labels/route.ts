// The printable sheet of QR labels (FR-AST-01). A route handler rather than a page because it
// answers with a file, guarded exactly as the register is: `listAssets` already narrows to the
// entities the viewer keeps, so a sheet can never carry a label for an asset they may not see.
//
// Generated on the way out and never stored.
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/env";
import { canManageAssets } from "@/modules/assets/policy";
import { listLabelRows } from "@/modules/assets/service";
import { renderLabelSheetPdf } from "@/modules/assets/labels";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { documentFont } from "@/modules/platform/pdf/load-font";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") ?? undefined;
  if (!canManageAssets(user.principal, entityId)) {
    await recordAudit({ action: "asset.labels.denied", actor: { userId: user.userId, personId: user.person.id, email: user.email }, request: user.request });
    return new Response(null, { status: 404 });
  }

  const rows = await listLabelRows(user.principal, { entityId, assetIds: url.searchParams.getAll("assetId") });
  if (rows.length === 0) return new Response(null, { status: 404 });

  const t = await getTranslations("assets.labels");
  const base = env().BETTER_AUTH_URL;
  const pdf = renderLabelSheetPdf({
    rows: rows.map((row) => ({ code: row.code, name: row.name, entityName: row.entityName, url: `${base}/assets/qr/${row.qrToken}` })),
    labels: { title: t("title"), footer: t("footer", { at: new Date().toLocaleDateString("vi-VN") }), scanHint: t("scanHint") },
    font: documentFont(),
  });

  await recordAudit({
    action: "asset.labels",
    actor: { userId: user.userId, personId: user.person.id, email: user.email },
    request: user.request,
    summary: String(rows.length),
  });

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="asset-labels.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
