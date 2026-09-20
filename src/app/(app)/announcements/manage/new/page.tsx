import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { audienceOptionsFor, canPostAnywhere } from "@/modules/comms/service";
import { AnnouncementForm } from "@/modules/comms/ui/announcement-form";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "New announcement" };

export default async function NewAnnouncementPage() {
  const user = await requireUser();
  if (!canPostAnywhere(user.principal)) notFound();
  const t = await getTranslations("comms");
  const choices = await audienceOptionsFor(user.principal);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/announcements/manage" className="hover:underline">
            {t("manage.title")}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t("manage.new")}</h1>
      </header>
      <AnnouncementForm choices={choices} draft={{ id: null, title: "", body: "", kbPageId: null, pinned: false, mustAcknowledge: false, expiresAt: "", publishAt: "", audience: [], published: false }} />
    </div>
  );
}
