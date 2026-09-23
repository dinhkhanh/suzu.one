import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { canPostAnywhere, commsViewerOf, listAnnouncementsFor } from "@/modules/comms/service";
import { AnnouncementList } from "@/modules/comms/ui/cards";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("announcements");

export default async function AnnouncementsPage() {
  const user = await requireUser();
  const [t, cards] = await Promise.all([getTranslations("comms"), commsViewerOf(user).then((viewer) => listAnnouncementsFor(viewer, { limit: 100 }))]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1>{t("list.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("list.help")}</p>
        </div>
        {canPostAnywhere(user.principal) ? (
          <Link href="/announcements/manage" className="text-sm underline underline-offset-2">
            {t("manage.title")}
          </Link>
        ) : null}
      </header>
      <AnnouncementList cards={cards} empty={t("list.empty")} />
    </div>
  );
}
