import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { findAssetByQrToken } from "@/modules/assets/service";

export const dynamic = "force-dynamic";

// Where a scanned label lands (FR-AST-01). The token *identifies* the asset; it does not admit
// anyone to it — the asset's own page re-checks who is asking, and answers 404 to a stranger
// exactly as it would for an asset that does not exist. A signed-out scan goes to sign-in first.
export default async function ScanPage({ params }: PageProps<"/assets/qr/[token]">) {
  await requireUser();
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const asset = await findAssetByQrToken(token);
  if (!asset) notFound();
  redirect(`/assets/${asset.id}`);
}
