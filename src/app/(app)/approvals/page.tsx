import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listInbox, listMyRequests } from "@/modules/platform/approvals/service";
import { RequestTable } from "@/modules/platform/approvals/ui/request-views";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Approvals" };

// One inbox for every kind of request. Each row opens the page of the module that owns its type.
export default async function ApprovalsPage() {
  const user = await requireUser();
  const [inbox, mine] = await Promise.all([listInbox(user.person.id), listMyRequests(user.person.id)]);
  const t = await getTranslations("approvals");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("inbox", { count: inbox.length })}</h2>
        <RequestTable rows={inbox} empty={t("inboxEmpty")} showRequester />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("mine")}</h2>
        <RequestTable rows={mine} empty={t("mineEmpty")} showRequester={false} />
      </section>
    </div>
  );
}
