import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { loadApprovalsPage } from "@/modules/platform/approvals/service";
import { BulkInbox } from "@/modules/platform/approvals/ui/bulk-inbox";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";
import { RequestTabs } from "@/modules/requests/ui/request-tabs";
import { bulkApproveAction } from "./actions";
import { allRequestTypes } from "./registry";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("approvals");

// One inbox for every kind of request. Each row opens the page of the module that owns its type.
export default async function ApprovalsPage() {
  const user = await requireUser();
  // Which waiting requests may be approved unopened is their type's call (the registry knows every type).
  const [{ inbox, mine }, registered, t, tRequests, locale] = await Promise.all([loadApprovalsPage(user.person.id), allRequestTypes(), getTranslations("approvals"), getTranslations("requests"), getLocale()]);
  const labels = new Map([...registered].flatMap(([type, entry]) => (entry.names ? [[type, locale === "en" ? entry.names.en : entry.names.vi] as const] : [])));
  const inboxRows = inbox.map((row) => ({
    id: row.id,
    type: row.type,
    summary: row.summary,
    link: row.link,
    createdAt: row.createdAt,
    requesterPersonId: row.requesterPersonId,
    requesterName: row.requesterName,
    bulk: !!registered.get(row.type)?.definition.bulkApprovable?.(row.request),
  }));

  return (
    <Page>
      <PageHeader
        title={tRequests("hub")}
        description={t("description")}
        actions={
          <>
            <Link href="/approvals/delegation" className={buttonVariants({ variant: "outline" })}>
              {t("delegation.link")}
            </Link>
            <Link href="/requests/new" className={buttonVariants()}>
              {tRequests("newShort")}
            </Link>
          </>
        }
      />
      <RequestTabs active="inbox" personId={user.person.id} principal={user.principal} />
      <Section title={t("inbox", { count: inbox.length })}>
        <BulkInbox rows={inboxRows} action={bulkApproveAction} labels={Object.fromEntries(labels)} />
      </Section>
      <Section title={t("mine")} count={mine.length || undefined}>
        <RequestTable rows={mine} empty={t("mineEmpty")} showRequester={false} labels={labels} />
      </Section>
    </Page>
  );
}
