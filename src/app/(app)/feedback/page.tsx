import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { TableAddRow, TableCard, TableCardHeader } from "@/components/ui/table";
import { canOpenFeedbackInbox } from "@/modules/feedback/policy";
import { listMyFeedback } from "@/modules/feedback/service";
import { FeedbackForm } from "@/modules/feedback/ui/feedback-form";
import { FeedbackList } from "@/modules/feedback/ui/feedback-list";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("feedback");

export default async function FeedbackPage() {
  const user = await requireUser();
  const [t, mine] = await Promise.all([getTranslations("feedback"), listMyFeedback(user.person.id)]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1>{t("page.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("page.help")}</p>
        </div>
        {canOpenFeedbackInbox(user.principal) ? (
          <Link href="/feedback/inbox" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("page.inbox")}
          </Link>
        ) : null}
      </header>
      <TableCard>
        <TableCardHeader title={t("page.mine")} count={mine.length || null} />
        <FeedbackList items={mine} showPerson={false} empty={t("page.mineEmpty")} />
        <TableAddRow label={t("page.send")} open={mine.length === 0}>
          <FeedbackForm pagePath={null} />
        </TableAddRow>
      </TableCard>
    </div>
  );
}
