import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { atLeast, canCreatePage, kbViewerOf, listTree, loadPage, loadSpace, spaceLevel } from "@/modules/kb/service";
import { ImportPageForm } from "@/modules/kb/ui/import-form";

export const metadata: Metadata = { title: "Import a page" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ImportPagePage(props: PageProps<"/kb/spaces/[spaceKey]/import">) {
  const user = await requireUser();
  const { spaceKey } = await props.params;
  const query = await props.searchParams;
  const viewer = kbViewerOf(user);
  const loaded = /^[a-z0-9-]{1,40}$/.test(spaceKey) ? await loadSpace({ key: spaceKey }) : null;
  if (!loaded || loaded.space.archivedAt || !spaceLevel(viewer, loaded.facts)) notFound();

  // Under a page the viewer may edit (a delegated subtree), or anywhere for the space's editors.
  const parentId = typeof query.parent === "string" && UUID.test(query.parent) ? query.parent : "";
  const parent = parentId ? await loadPage(parentId) : null;
  const spaceEditor = atLeast(spaceLevel(viewer, loaded.facts), "edit");
  if (!spaceEditor && !(parent && parent.page.spaceId === loaded.space.id && canCreatePage(viewer, loaded.facts, parent.pageFacts))) notFound();

  const t = await getTranslations("kb");
  const tree = await listTree(viewer, loaded);
  const parents = spaceEditor ? tree : tree.filter((node) => node.id === parentId);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href={`/kb/spaces/${loaded.space.key}`} className="hover:underline">
            {loaded.space.name}
          </Link>
        </p>
        <h1>{t("import.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("import.help")}</p>
      </header>
      <ImportPageForm spaceId={loaded.space.id} parents={parents.map((node) => ({ id: node.id, title: node.title, depth: node.depth }))} defaultParentId={parents.some((node) => node.id === parentId) ? parentId : ""} />
    </div>
  );
}
