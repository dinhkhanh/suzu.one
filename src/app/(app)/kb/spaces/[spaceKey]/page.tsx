import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/modules/platform/auth/session";
import { setSpaceAccessAction } from "@/modules/kb/actions";
import { parseSubjectKey } from "@/modules/kb/enums";
import { atLeast, kbViewerOf, listTree, loadSpace, spaceLevel, subjectNames, subjectOptions } from "@/modules/kb/service";
import { AccessForm } from "@/modules/kb/ui/access-form";
import { PageTree } from "@/modules/kb/ui/page-tree";
import { ArchiveSpaceButton, SpaceSettingsForm } from "@/modules/kb/ui/space-forms";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function SpacePage(props: PageProps<"/kb/spaces/[spaceKey]">) {
  const user = await requireUser();
  const { spaceKey } = await props.params;
  const viewer = kbViewerOf(user);
  const loaded = /^[a-z0-9-]{1,40}$/.test(spaceKey) ? await loadSpace({ key: spaceKey }) : null;
  const level = loaded ? spaceLevel(viewer, loaded.facts) : null;
  if (!loaded || !level) notFound();

  const t = await getTranslations("kb");
  const tRoles = await getTranslations("roles");
  const { space } = loaded;
  const tree = await listTree(viewer, loaded);
  const manages = level === "manage";
  const [names, choices] = manages ? await Promise.all([subjectNames(loaded.access.map((row) => row.subjectKey)), subjectOptions()]) : [new Map<string, string>(), null];
  const rows = loaded.access.map((row) => {
    const subject = parseSubjectKey(row.subjectKey);
    const name = subject?.type === "role" ? tRoles(subject.id as "owner") : (names.get(row.subjectKey) ?? "");
    return { ...row, label: !subject || subject.type === "all" ? t("access.subject.all") : `${t(`access.subject.${subject.type}`)}: ${name}` };
  });

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          <Link href="/kb" className="hover:underline">
            {t("title")}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            <span aria-hidden>{space.icon ?? "📄"}</span> {space.name}
          </h1>
          {space.kind === "controlled" ? <Badge variant="outline">{t("space.kind.controlled")}</Badge> : null}
          {space.archivedAt ? <Badge variant="secondary">{t("space.archived")}</Badge> : null}
        </div>
        {space.description ? <p className="text-sm text-muted-foreground">{space.description}</p> : null}
        {space.kind === "controlled" ? <p className="text-xs text-muted-foreground">{t("space.controlledNote")}</p> : null}
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t("space.pagesTitle")}</h2>
          {atLeast(level, "edit") && !space.archivedAt ? (
            <Link href={`/kb/spaces/${space.key}/new`} className={buttonVariants({ size: "sm" })}>
              {t("page.new")}
            </Link>
          ) : null}
        </div>
        <PageTree tree={tree} />
      </section>

      {manages && choices ? (
        <>
          <section className="flex flex-col gap-3 rounded-md border p-4">
            <h2 className="text-sm font-medium">{t("access.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("access.spaceHelp")}</p>
            <AccessForm target={{ spaceId: space.id }} rows={rows} choices={choices} action={setSpaceAccessAction} />
          </section>
          <section className="flex flex-col gap-3 rounded-md border p-4">
            <h2 className="text-sm font-medium">{t("space.settings")}</h2>
            <SpaceSettingsForm space={{ id: space.id, name: space.name, description: space.description, icon: space.icon, kind: space.kind, sortOrder: space.sortOrder }} />
            <div>
              <ArchiveSpaceButton spaceId={space.id} archived={!!space.archivedAt} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
