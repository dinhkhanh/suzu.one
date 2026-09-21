import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { commsViewerOf, getAnnouncementView, markAnnouncementRead } from "@/modules/comms/service";
import { AcknowledgeAnnouncementButton } from "@/modules/comms/ui/buttons";
import { PlainText } from "@/modules/comms/ui/cards";
import { canViewPage, kbViewerOf, loadPage } from "@/modules/kb/service";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Announcement" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AnnouncementPage(props: PageProps<"/announcements/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const viewer = await commsViewerOf(user);
  const view = UUID.test(id) ? await getAnnouncementView(viewer, id) : null;
  if (!view) notFound();
  // Opening it is reading it — for the people it was written for.
  if (view.isReader && !view.readAt) await markAnnouncementRead(viewer, id);

  const t = await getTranslations("comms");
  const format = await getFormatter();
  const { row } = view;
  // The linked page's title only if this reader may open that page.
  const linked = row.kbPageId ? await loadPage(row.kbPageId) : null;
  const page = linked && canViewPage(kbViewerOf(user), linked.facts, linked.pageFacts) ? linked.page : null;

  return (
    <article className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/announcements" className="hover:underline">
            {t("list.title")}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1>{row.title}</h1>
          {row.pinned ? <Badge variant="secondary">{t("list.pinned")}</Badge> : null}
          {view.phase === "live" ? null : <Badge variant="outline">{t(`phase.${view.phase}`)}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {view.authorName}
          {row.publishAt ? ` · ${format.dateTime(row.publishAt, { dateStyle: "long", timeStyle: "short" })}` : ""}
        </p>
      </header>

      <PlainText text={row.body} />

      {page ? (
        <p className="text-sm">
          {t("detail.readMore")}{" "}
          <Link href={`/kb/pages/${page.id}`} className="underline underline-offset-2">
            {page.publishedTitle ?? page.title}
          </Link>
        </p>
      ) : null}

      {row.mustAcknowledge && view.isReader ? (
        <section className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
          {view.acknowledgedAt ? <span>{t("detail.acknowledgedOn", { date: format.dateTime(view.acknowledgedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span> : <><span>{t("detail.mustAcknowledge")}</span><AcknowledgeAnnouncementButton id={row.id} /></>}
        </section>
      ) : null}

      {view.canManage ? (
        <p className="text-sm">
          <Link href={`/announcements/manage/${row.id}`} className="underline underline-offset-2">
            {t("detail.manage")}
          </Link>
        </p>
      ) : null}
    </article>
  );
}
