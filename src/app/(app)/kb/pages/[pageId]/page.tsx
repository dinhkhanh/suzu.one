import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { pagePath } from "@/modules/kb/enums";
import { kbViewerOf, levelOf, loadPage } from "@/modules/kb/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A page by its id — the links from before page addresses, notifications, citations — sent on to
 * where it is read now, /kb/spaces/<key>/<slug> (a citation's #section goes along). Only someone
 * who may open the page learns its address.
 */
export default async function KbPageById(props: PageProps<"/kb/pages/[pageId]">) {
  const user = await requireUser();
  const { pageId } = await props.params;
  const query = await props.searchParams;
  const loaded = UUID.test(pageId) ? await loadPage(pageId) : null;
  if (!loaded || !levelOf(kbViewerOf(user), loaded)) notFound();
  const path = pagePath(loaded.space.key, loaded.page);
  redirect(query.draft === "1" ? `${path}?draft=1` : path);
}
