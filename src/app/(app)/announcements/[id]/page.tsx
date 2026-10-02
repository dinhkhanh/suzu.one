import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { commsViewerOf, getAnnouncementView, markAnnouncementRead } from "@/modules/comms/service";
import { AcknowledgeAnnouncementButton } from "@/modules/comms/ui/buttons";
import { canViewPage, kbViewerOf, loadPage } from "@/modules/kb/service";
import { requireUser } from "@/modules/platform/auth/session";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";

export const generateMetadata = pageTitle("announcement");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AnnouncementPage(props: PageProps<"/announcements/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const viewer = await commsViewerOf(user);
  const view = UUID.test(id) ? await getAnnouncementView(viewer, id) : null;
  if (!view) notFound();
  const { row } = view;
  const [t, format, linked] = await Promise.all([
    getTranslations("comms"),
    getFormatter(),
    // The linked page's title only if this reader may open that page.
    row.kbPageId ? loadPage(row.kbPageId) : null,
    // Opening it is reading it — for the people it was written for.
    view.isReader && !view.readAt ? markAnnouncementRead(viewer, id, view) : false,
  ]);
  const page = linked && canViewPage(kbViewerOf(user), linked.facts, linked.pageFacts) ? linked.page : null;

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <Link href="/announcements" className="hover:underline">
            {t("list.title")}
          </Link>
        }
        title={row.title}
        description={
          <>
            <RecordLink kind="person" id={row.authorPersonId}>
              {view.authorName}
            </RecordLink>
            {row.publishAt ? ` · ${format.dateTime(row.publishAt, { dateStyle: "long", timeStyle: "short" })}` : ""}
          </>
        }
        actions={
          view.canManage ? (
            <Link href={`/announcements/manage/${row.id}`} className={cn(buttonVariants({ variant: "outline" }))}>
              {t("detail.manage")}
            </Link>
          ) : null
        }
      >
        {row.pinned || view.phase !== "live" ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {row.pinned ? <Badge variant="secondary">{t("list.pinned")}</Badge> : null}
            {view.phase === "live" ? null : <Badge variant="outline">{t(`phase.${view.phase}`)}</Badge>}
          </div>
        ) : null}
      </PageHeader>

      <article>
        <RichText text={row.body} className="break-words" />
      </article>

      {page ? (
        <p className="text-sm">
          {t("detail.readMore")}{" "}
          <RecordLink kind="kbPage" id={page.id} className="text-link underline underline-offset-2">
            {page.publishedTitle ?? page.title}
          </RecordLink>
        </p>
      ) : null}

      {row.mustAcknowledge && view.isReader ? (
        view.acknowledgedAt ? (
          <Alert variant="success">{t("detail.acknowledgedOn", { date: format.dateTime(view.acknowledgedAt, { dateStyle: "medium", timeStyle: "short" }) })}</Alert>
        ) : (
          <Alert variant="warning">
            <span className="flex-1">{t("detail.mustAcknowledge")}</span>
            <AcknowledgeAnnouncementButton id={row.id} />
          </Alert>
        )
      ) : null}
    </Page>
  );
}
