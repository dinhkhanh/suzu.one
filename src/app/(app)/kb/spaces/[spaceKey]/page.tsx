import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { setSpaceAccessAction } from "@/modules/kb/actions";
import { parseSubjectKey } from "@/modules/kb/enums";
import { atLeast, kbViewerOf, listSpaceFiles, listSpaces, listTree, loadSpace, spaceLevel, subjectNames, subjectOptions } from "@/modules/kb/service";
import { AccessForm } from "@/modules/kb/ui/access-form";
import { KbShell } from "@/modules/kb/ui/kb-shell";
import { PageTree } from "@/modules/kb/ui/page-tree";
import { KbSearchBox } from "@/modules/kb/ui/search-box";
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
  const [t, tRoles, spaces, tree, files, names, choices] = await Promise.all([
    getTranslations("kb"),
    getTranslations("roles"),
    listSpaces(viewer),
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
  const mayAdd = atLeast(level, "edit") && !space.archivedAt;

  return (
    <KbShell spaces={spaces} currentSpaceKey={space.key} tree={tree}>
      <Page width="default" className="max-w-3xl">
        <PageHeader
          eyebrow={
            <Link href="/kb" className="hover:underline">
              {t("title")}
            </Link>
          }
          title={space.name}
          description={space.description ?? undefined}
          actions={
            mayAdd ? (
              <Link href={`/kb/spaces/${space.key}/new`} className={buttonVariants()}>
                {t("page.new")}
              </Link>
            ) : null
          }
        >
          {space.kind === "controlled" || space.archivedAt ? (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {space.kind === "controlled" ? <Badge variant="secondary">{t("space.kind.controlled")}</Badge> : null}
              {space.archivedAt ? <Badge variant="outline">{t("space.archived")}</Badge> : null}
            </div>
          ) : null}
          {space.kind === "controlled" ? <p className="text-xs text-faint">{t("space.controlledNote")}</p> : null}
          <KbSearchBox spaceId={space.id} compact className="mt-2 max-w-md" />
        </PageHeader>

        <Section title={t("space.pagesTitle")} count={tree.length || null}>
          <TableCard>
            <PageTree tree={tree} spaceKey={space.key} className="p-2" />
            {mayAdd ? <TableAddRow label={t("page.new")} href={`/kb/spaces/${space.key}/new`} /> : null}
          </TableCard>
        </Section>

        {files.length > 0 ? (
          <Section title={t("space.documentsTitle")} count={files.length}>
            <p className="text-xs text-faint">{t("space.documentsHelp")}</p>
            <TableCard>
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
                      <TableCell kind="number" className="text-muted-foreground">
                        {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
                      </TableCell>
                      <TableCell kind="link" className="max-w-64 truncate">
                        <Link href={`/kb/pages/${file.pageId}`}>{file.pageTitle}</Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{file.uploadedByName ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
          </Section>
        ) : null}

        {manages && choices ? (
          <>
            <Section title={t("access.title")}>
              <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
                <p className="text-xs text-faint">{t("access.spaceHelp")}</p>
                <AccessForm target={{ spaceId: space.id }} rows={rows} choices={choices} action={setSpaceAccessAction} />
              </div>
            </Section>
            <Section title={t("space.settings")}>
              <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-background p-4">
                <SpaceSettingsForm space={{ id: space.id, key: space.key, name: space.name, description: space.description, icon: space.icon, kind: space.kind, sortOrder: space.sortOrder }} />
                <div>
                  <ArchiveSpaceButton spaceId={space.id} archived={!!space.archivedAt} />
                </div>
              </div>
            </Section>
          </>
        ) : null}
      </Page>
    </KbShell>
  );
}
