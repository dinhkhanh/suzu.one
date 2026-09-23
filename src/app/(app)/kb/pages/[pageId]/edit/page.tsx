import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { atLeast, canPublishDirectly, kbViewerOf, levelOf, loadPage, syncReviewState } from "@/modules/kb/service";
import { PageEditor } from "@/modules/kb/ui/editor";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("editPage");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditKbPage(props: PageProps<"/kb/pages/[pageId]/edit">) {
  const user = await requireUser();
  const { pageId } = await props.params;
  const viewer = kbViewerOf(user);
  let loaded = UUID.test(pageId) ? await loadPage(pageId) : null;
  if (loaded && loaded.page.status === "in_review" && (await syncReviewState(loaded.page))) loaded = await loadPage(pageId);
  // Someone who may read but not edit gets the same answer as someone who may not read.
  if (!loaded || !atLeast(levelOf(viewer, loaded), "edit")) notFound();

  const t = await getTranslations("kb");
  const { page, space } = loaded;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        <Link href={`/kb/spaces/${space.key}`} className="hover:underline">
          {space.name}
        </Link>
        <span aria-hidden> / </span>
        <Link href={`/kb/pages/${page.id}`} className="hover:underline">
          {t("page.backToPage")}
        </Link>
      </p>
      {page.status === "in_review" ? (
        <p className="rounded-md border p-3 text-sm">
          {t("errors.kb_page_in_review")}{" "}
          {page.reviewRequestId ? (
            <Link href={`/approvals/kb-publish/${page.reviewRequestId}`} className="underline underline-offset-2">
              {t("review.open")}
            </Link>
          ) : null}
        </p>
      ) : (
        <PageEditor pageId={page.id} initialTitle={page.title} initialContent={page.content} canPublish={canPublishDirectly(viewer, loaded.facts, loaded.pageFacts)} controlled={space.kind === "controlled"} />
      )}
    </div>
  );
}
