import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { findActionToken } from "@/modules/platform/approvals/action-tokens";
import { getRequestRows } from "@/modules/platform/approvals/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ActOnRequest } from "@/modules/platform/approvals/ui/act-form";
import { approveFromLinkAction } from "../../actions";

export const metadata: Metadata = { title: "Approve", robots: { index: false, follow: false } };

// Approve straight from a notification (FR-PLT-24). The link is a shortcut, never a credential:
// `requireUser` demands a real session, the token must name *that* person, and the button below
// runs the owning module's ordinary decide action, which checks it really is their turn. The page
// only ever shows what the reader could already see on the request itself.
export default async function ApproveFromLinkPage(props: PageProps<"/approvals/act/[token]">) {
  const user = await requireUser();
  const { token } = await props.params;
  const t = await getTranslations("approvals.deepLink");

  const lookup = await findActionToken(token);
  // Someone else's link says exactly what a link that never existed says.
  const usable = lookup.ok && lookup.row.personId === user.person.id;
  const reason = !lookup.ok ? lookup.reason : usable ? null : "unknown";
  const [request] = usable ? await getRequestRows([lookup.row.requestId]) : [];

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      {reason || !request ? (
        <div className="flex flex-col gap-3 rounded-xl border p-4">
          <p role="alert" className="text-sm text-destructive">
            {t(`refused.${reason ?? "unknown"}` as "refused.unknown")}
          </p>
          <Link href="/approvals" className="text-sm underline-offset-4 hover:underline">
            {t("openInbox")}
          </Link>
        </div>
      ) : (
        <ActOnRequest token={token} summary={request.summary} link={request.link} typeName={request.typeName ?? request.type} approve={approveFromLinkAction} />
      )}
    </div>
  );
}
