import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { setSpaceAccessAction } from "@/modules/kb/actions";
import { parseSubjectKey } from "@/modules/kb/enums";
import { atLeast, kbViewerOf, listSpaceFiles, listTree, loadSpace, spaceLevel, subjectNames, subjectOptions } from "@/modules/kb/service";
import { AccessForm } from "@/modules/kb/ui/access-form";
import { PageTree } from "@/modules/kb/ui/page-tree";
import { ArchiveSpaceButton, SpaceSettingsForm } from "@/modules/kb/ui/space-forms";
import { pageTitle } from "@/i18n/page-title";
import { KbFileLink } from "@/modules/kb/ui/kb-file-link";

export const generateMetadata = pageTitle("knowledgeBase");

export default async function SpacePage(props: PageProps<"/kb/spaces/[spaceKey]">) {
  const user = await requireUser();
  const { spaceKey } = await props.params;
  const viewer = kbViewerOf(user);
  const loaded = /^[a-z0-9-]{1,40}$/.test(spaceKey) ? await loadSpace({ key: spaceKey }) : null;
  const level = loaded ? spaceLevel(viewer, loaded.facts) : null;
  if (!loaded || !level) notFound();
  // A key the space had before: on to the one it has now.
  if (loaded.space.key !== spaceKey) redirect(`/kb/spaces/${loaded.space.key}`);

  const { space } = loaded;
  const manages = level === "manage";
  const [t, tRoles, tree, files, names, choices] = await Promise.all([
    getTranslations("kb"),
    getTranslations("roles"),
    listTree(viewer, loaded),
    listSpaceFiles(viewer, loaded.space.id),
    manages ? subjectNames(loaded.access.map((row) => row.subjectKey)) : new Map<string, string>(),
    // The directory is for setting access; a collaborator gets no directory anywhere.
    manages && user.principal.workforceType !== "collaborator" ? subjectOptions() : null,
  ]);
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
          <h1>
            <span aria-hidden>{space.icon ?? "📄"}</span> {space.name}
          </h1>
          {space.kind === "controlled" ? <Badge variant="outline">{t("space.kind.controlled")}</Badge> : null}
          {space.archivedAt ? <Badge variant="secondary">{t("space.archived")}</Badge> : null}
        </div>
        {space.description ? <p className="text-sm text-muted-foreground">{space.description}</p> : null}
        {space.kind === "controlled" ? <p className="text-xs text-muted-foreground">{t("space.controlledNote")}</p> : null}
      </header>

      <TableCard>
        <TableCardHeader title={t("space.pagesTitle")} />
        <div className="p-3">
          <PageTree tree={tree} spaceKey={loaded.space.key} />
        </div>
        {atLeast(level, "edit") && !space.archivedAt ? <TableAddRow label={t("page.new")} href={`/kb/spaces/${space.key}/new`} /> : null}
      </TableCard>

      {files.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("space.documentsTitle")} count={files.length} description={t("space.documentsHelp")} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="file">{t("space.fileName")}</TableHead>
                <TableHead kind="number">{t("space.fileSize")}</TableHead>
                <TableHead kind="link">{t("review.page")}</TableHead>
                <TableHead kind="person">{t("space.uploadedBy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="max-w-80 truncate">
                    <KbFileLink fileId={file.id} fileName={file.fileName} className="font-medium underline underline-offset-2">
                      {file.fileName}
                    </KbFileLink>
                  </TableCell>
                  <TableCell kind="number" className="text-muted-foreground">{Math.max(1, Math.round(file.sizeBytes / 1024))} KB</TableCell>
                  <TableCell kind="link" className="max-w-64 truncate">
                    <Link href={`/kb/pages/${file.pageId}`}>{file.pageTitle}</Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{file.uploadedByName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {manages && choices ? (
        <>
          <section className="flex flex-col gap-3 rounded-md border p-4">
            <h2 className="text-sm font-medium">{t("access.title")}</h2>
            <p className="text-xs text-muted-foreground">{t("access.spaceHelp")}</p>
            <AccessForm target={{ spaceId: space.id }} rows={rows} choices={choices} action={setSpaceAccessAction} />
          </section>
          <section className="flex flex-col gap-3 rounded-md border p-4">
            <h2 className="text-sm font-medium">{t("space.settings")}</h2>
            <SpaceSettingsForm space={{ id: space.id, key: space.key, name: space.name, description: space.description, icon: space.icon, kind: space.kind, sortOrder: space.sortOrder }} />
            <div>
              <ArchiveSpaceButton spaceId={space.id} archived={!!space.archivedAt} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
