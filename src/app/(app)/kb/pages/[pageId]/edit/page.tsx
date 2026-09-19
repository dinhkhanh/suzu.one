import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { atLeast, canPublishDirectly, kbViewerOf, levelOf, loadPage } from "@/modules/kb/service";
import { PageEditor } from "@/modules/kb/ui/editor";

export const metadata: Metadata = { title: "Edit page" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditKbPage(props: PageProps<"/kb/pages/[pageId]/edit">) {
  const user = await requireUser();
  const { pageId } = await props.params;
  const viewer = kbViewerOf(user);
  const loaded = UUID.test(pageId) ? await loadPage(pageId) : null;
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
      {page.status === "in_review" ? <p className="rounded-md border p-3 text-sm">{t("errors.kb_page_in_review")}</p> : <PageEditor pageId={page.id} initialTitle={page.title} initialContent={page.content} canPublish={canPublishDirectly(viewer, loaded.facts, loaded.pageFacts)} controlled={space.kind === "controlled"} />}
    </div>
  );
}
