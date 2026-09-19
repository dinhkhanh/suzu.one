import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getRequestRows, listInbox, listMyRequests } from "@/modules/platform/approvals/service";
import { BulkInbox } from "@/modules/platform/approvals/ui/bulk-inbox";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { bulkApproveAction } from "./actions";
import { REQUEST_TYPES } from "./registry";

export const metadata: Metadata = { title: "Approvals" };

// One inbox for every kind of request. Each row opens the page of the module that owns its type.
export default async function ApprovalsPage() {
  const user = await requireUser();
  const [inbox, mine] = await Promise.all([listInbox(user.person.id), listMyRequests(user.person.id)]);
  const t = await getTranslations("approvals");
  // Which waiting requests may be approved unopened is their type's call (the registry knows every type).
  const full = new Map((await getRequestRows(inbox.map((row) => row.id))).map((row) => [row.id, row]));
  const inboxRows = inbox.map((row) => ({ id: row.id, type: row.type, summary: row.summary, link: row.link, createdAt: row.createdAt, requesterName: row.requesterName, bulk: !!(full.get(row.id) && REQUEST_TYPES.get(row.type)?.definition.bulkApprovable?.(full.get(row.id)!)) }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/approvals/delegation" className="text-sm underline-offset-4 hover:underline">
          {t("delegation.link")}
        </Link>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("inbox", { count: inbox.length })}</h2>
        <BulkInbox rows={inboxRows} action={bulkApproveAction} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("mine")}</h2>
        <RequestTable rows={mine} empty={t("mineEmpty")} showRequester={false} />
      </section>
    </div>
  );
}
