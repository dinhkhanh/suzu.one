import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Page, PageHeader } from "@/components/ui/page";
import { buttonVariants } from "@/components/ui/button";
import { RecordLink } from "@/components/ui/record-link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { atLeast, canCreatePage, kbViewerOf, listTemplates, listTree, loadPage, loadSpace, spaceLevel } from "@/modules/kb/service";
import { NewPageForm } from "@/modules/kb/ui/page-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newPage");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewPagePage(props: PageProps<"/kb/spaces/[spaceKey]/new">) {
  const user = await requireUser();
  const { spaceKey } = await props.params;
  const query = await props.searchParams;
  const viewer = kbViewerOf(user);
  const loaded = /^[a-z0-9-]{1,40}$/.test(spaceKey) ? await loadSpace({ key: spaceKey }) : null;
  if (!loaded || loaded.space.archivedAt || !spaceLevel(viewer, loaded.facts)) notFound();
  if (loaded.space.key !== spaceKey) redirect(`/kb/spaces/${loaded.space.key}/new${typeof query.parent === "string" ? `?parent=${encodeURIComponent(query.parent)}` : ""}`);

  // Under a page the viewer may edit (a delegated subtree), or anywhere for the space's editors.
  const parentId = typeof query.parent === "string" && UUID.test(query.parent) ? query.parent : "";
  const parent = parentId ? await loadPage(parentId) : null;
  const spaceEditor = atLeast(spaceLevel(viewer, loaded.facts), "edit");
  if (!spaceEditor && !(parent && parent.page.spaceId === loaded.space.id && canCreatePage(viewer, loaded.facts, parent.pageFacts))) notFound();

  const t = await getTranslations("kb");
  const [tree, templates] = await Promise.all([listTree(viewer, loaded), listTemplates()]);
  const parents = spaceEditor ? tree : tree.filter((node) => node.id === parentId);

  return (
    <Page>
      <PageHeader
        eyebrow={
          <RecordLink kind="kbSpace" id={loaded.space.key}>
            {loaded.space.name}
          </RecordLink>
        }
        title={t("page.new")}
        actions={
          <Link href={`/kb/spaces/${loaded.space.key}/import${parentId ? `?parent=${parentId}` : ""}`} className={buttonVariants({ variant: "outline" })}>
            {t("import.link")}
          </Link>
        }
      />
      <NewPageForm
        spaceId={loaded.space.id}
        spaceKey={loaded.space.key}
        parents={parents.map((node) => ({ id: node.id, title: node.title, depth: node.depth }))}
        defaultParentId={parents.some((node) => node.id === parentId) ? parentId : ""}
        templates={templates}
      />
    </Page>
  );
}
