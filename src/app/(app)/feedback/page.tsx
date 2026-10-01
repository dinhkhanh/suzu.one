import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { TableAddRow, TableCard, TableCardHeader } from "@/components/ui/table";
import { canOpenFeedbackInbox } from "@/modules/feedback/policy";
import { listMyFeedback } from "@/modules/feedback/service";
import { FeedbackForm } from "@/modules/feedback/ui/feedback-form";
import { FeedbackList } from "@/modules/feedback/ui/feedback-list";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("feedback");

export default async function FeedbackPage() {
  const user = await requireUser();
  const [t, mine] = await Promise.all([getTranslations("feedback"), listMyFeedback(user.person.id)]);

  return (
    <Page>
      <PageHeader
        title={t("page.title")}
        description={t("page.help")}
        actions={
          canOpenFeedbackInbox(user.principal) ? (
            <Link href="/feedback/inbox" className={cn(buttonVariants({ variant: "outline" }))}>
              {t("page.inbox")}
            </Link>
          ) : null
        }
      />
      <TableCard>
        <TableCardHeader title={t("page.mine")} count={mine.length || null} />
        <FeedbackList items={mine} showPerson={false} empty={t("page.mineEmpty")} />
        <TableAddRow label={t("page.send")} open={mine.length === 0}>
          <FeedbackForm pagePath={null} />
        </TableAddRow>
      </TableCard>
    </Page>
  );
}
