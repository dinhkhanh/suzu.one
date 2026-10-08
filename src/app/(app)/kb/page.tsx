import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { canManageAnySpace, canManageSpace, countMyPendingAcks, type KbPageCard, kbViewerOf, listPopularPages, listRecentlyPublished, listRecentlyViewed, listSpaces } from "@/modules/kb/service";
import { SpaceIcon } from "@/modules/kb/ui/kb-shell";
import { KbSearchBox } from "@/modules/kb/ui/search-box";
import { NewSpaceForm } from "@/modules/kb/ui/space-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("knowledgeBase");

export default async function KnowledgeBasePage() {
  const user = await requireUser();
  const t = await getTranslations("kb");
  const viewer = kbViewerOf(user);
  const managesAny = canManageAnySpace(user.principal);
  const [spaces, recent, popular, updated, pendingAcks, entities, unitRows] = await Promise.all([
    listSpaces(viewer),
    listRecentlyViewed(viewer),
    listPopularPages(viewer),
    listRecentlyPublished(viewer),
    countMyPendingAcks(viewer),
    managesAny ? listEntities() : [],
    managesAny ? unitChoices() : [],
  ]);
  const lists: { key: "recent" | "popular" | "updated"; pages: KbPageCard[] }[] = [
    { key: "recent", pages: recent },
    { key: "popular", pages: popular },
    { key: "updated", pages: updated },
  ];
  // The form offers only what the action would accept: the entities the viewer's `kb:manage`
  // covers, and the units they lead — their own and everything below them (FR-KB-13).
  const manageable = entities.filter((entity) => canManageSpace(user.principal, { entityId: entity.id }));
  const units = unitRows.filter((unit) => canManageSpace(user.principal, { entityId: null, ownerUnitPath: [unit.id] }) && !spaces.some((space) => space.ownerUnitId === unit.id));
  const groupWide = canManageSpace(user.principal, { entityId: null });
  const mayCreate = groupWide || manageable.length > 0 || units.length > 0;
  const groups = [
    // A unit's own space first: for most people that is the one they came for.
    { key: "unit", spaces: spaces.filter((space) => space.ownerUnitId && !space.archivedAt) },
    { key: "group", spaces: spaces.filter((space) => !space.entityId && !space.ownerUnitId && !space.archivedAt) },
    { key: "entity", spaces: spaces.filter((space) => space.entityId && !space.ownerUnitId && !space.archivedAt) },
    { key: "archived", spaces: spaces.filter((space) => space.archivedAt) },
  ].filter((group) => group.spaces.length > 0);

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/kb/acknowledgements" className={buttonVariants({ variant: pendingAcks > 0 ? "default" : "outline" })}>
            {t("ack.myLink")}
            {pendingAcks > 0 ? <span className="font-mono text-xs tabular-nums opacity-80">{pendingAcks}</span> : null}
          </Link>
        }
      >
        <KbSearchBox className="mt-2" />
      </PageHeader>

      {groups.length === 0 ? (
        <List>
          <ListEmpty>{t("noSpaces")}</ListEmpty>
        </List>
      ) : null}
      {groups.map((group, index) => (
        <Section key={group.key} title={t(`groups.${group.key}`)} count={group.spaces.length}>
          <TableCard>
            <List>
              {group.spaces.map((space) => (
                <ListItem key={space.id} href={`/kb/spaces/${space.key}`}>
                  <SpaceIcon icon={space.icon} className="text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{space.name}</span>
                    {space.description ? <span className="truncate text-xs text-faint">{space.description}</span> : null}
                  </span>
                  <span className="hidden items-center gap-1.5 sm:flex">
                    {space.entityName ? <Badge variant="outline">{space.entityName}</Badge> : null}
                    {space.kind === "controlled" ? <Badge variant="secondary">{t("space.kind.controlled")}</Badge> : null}
                    {space.level !== "view" ? <Badge variant="outline">{t(`level.${space.level}`)}</Badge> : null}
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-xs whitespace-nowrap text-faint tabular-nums">{t("space.pages", { count: space.pageCount })}</span>
                </ListItem>
              ))}
            </List>
            {mayCreate && index === groups.length - 1 ? (
              <TableAddRow label={t("space.new")}>
                <NewSpaceForm entities={manageable.map((entity) => ({ id: entity.id, name: entity.shortName }))} units={units} groupWide={groupWide} />
              </TableAddRow>
            ) : null}
          </TableCard>
        </Section>
      ))}
      {groups.length === 0 && mayCreate ? (
        <TableCard>
          <TableAddRow label={t("space.new")} open>
            <NewSpaceForm entities={manageable.map((entity) => ({ id: entity.id, name: entity.shortName }))} units={units} groupWide={groupWide} />
          </TableAddRow>
        </TableCard>
      ) : null}

      {lists.some((list) => list.pages.length > 0) ? (
        <div className="grid gap-6 md:grid-cols-3 md:gap-4">
          {lists.map((list) => (
            <Section key={list.key} title={t(`lists.${list.key}`)}>
              <List>
                {list.pages.length === 0 ? <ListEmpty>—</ListEmpty> : null}
                {list.pages.map((page) => (
                  <ListItem key={page.pageId} href={`/kb/pages/${page.pageId}`} className="min-h-11 py-2 md:min-h-11">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[0.8125rem] font-medium">{page.title}</span>
                      <span className="truncate text-xs text-faint">
                        {page.spaceName}
                        {page.views ? ` · ${t("lists.views", { count: page.views })}` : ""}
                      </span>
                    </span>
                  </ListItem>
                ))}
              </List>
            </Section>
          ))}
        </div>
      ) : null}
    </Page>
  );
}
