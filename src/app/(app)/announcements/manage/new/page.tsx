import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { audienceOptionsFor, canPostAnywhere } from "@/modules/comms/service";
import { AnnouncementForm } from "@/modules/comms/ui/announcement-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newAnnouncement");

export default async function NewAnnouncementPage() {
  const user = await requireUser();
  if (!canPostAnywhere(user.principal)) notFound();
  const t = await getTranslations("comms");
  const choices = await audienceOptionsFor(user.principal);

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/announcements/manage" className="hover:underline">
            {t("manage.title")}
          </Link>
        }
        title={t("manage.new")}
      />
      <AnnouncementForm choices={choices} draft={{ id: null, title: "", body: "", kbPageId: null, pinned: false, mustAcknowledge: false, expiresAt: "", publishAt: "", audience: [], published: false }} />
    </Page>
  );
}
