import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { canPostAnywhere, commsViewerOf, listAnnouncementsFor } from "@/modules/comms/service";
import { AnnouncementCards } from "@/modules/comms/ui/cards";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("announcements");

export default async function AnnouncementsPage() {
  const user = await requireUser();
  const [t, cards] = await Promise.all([getTranslations("comms"), commsViewerOf(user).then((viewer) => listAnnouncementsFor(viewer, { limit: 100 }))]);

  return (
    <Page width="narrow">
      <PageHeader
        title={t("list.title")}
        description={t("list.help")}
        actions={
          canPostAnywhere(user.principal) ? (
            <Link href="/announcements/manage" className={cn(buttonVariants({ variant: "outline" }))}>
              {t("manage.title")}
            </Link>
          ) : null
        }
      />
      <AnnouncementCards cards={cards} empty={t("list.empty")} />
    </Page>
  );
}
