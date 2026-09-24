import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { loadApprovalsPage } from "@/modules/platform/approvals/service";
import { BulkInbox } from "@/modules/platform/approvals/ui/bulk-inbox";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { bulkApproveAction } from "./actions";
import { allRequestTypes } from "./registry";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("approvals");

// One inbox for every kind of request. Each row opens the page of the module that owns its type.
export default async function ApprovalsPage() {
  const user = await requireUser();
  // Which waiting requests may be approved unopened is their type's call (the registry knows every type).
  const [{ inbox, mine }, registered, t] = await Promise.all([loadApprovalsPage(user.person.id), allRequestTypes(), getTranslations("approvals")]);
  const labels = new Map([...registered].flatMap(([type, entry]) => (entry.names ? [[type, entry.names.vi] as const] : [])));
  const inboxRows = inbox.map((row) => ({ id: row.id, type: row.type, summary: row.summary, link: row.link, createdAt: row.createdAt, requesterName: row.requesterName, bulk: !!registered.get(row.type)?.definition.bulkApprovable?.(row.request) }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/approvals/delegation" className="text-sm underline-offset-4 hover:underline">
          {t("delegation.link")}
        </Link>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("inbox", { count: inbox.length })}</h2>
        <BulkInbox rows={inboxRows} action={bulkApproveAction} labels={Object.fromEntries(labels)} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("mine")}</h2>
        <RequestTable rows={mine} empty={t("mineEmpty")} showRequester={false} labels={labels} />
      </section>
    </div>
  );
}
