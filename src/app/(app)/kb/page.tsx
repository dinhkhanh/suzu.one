import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canManageAnySpace, canManageSpace, kbViewerOf, listSpaces } from "@/modules/kb/service";
import { NewSpaceForm } from "@/modules/kb/ui/space-forms";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgeBasePage() {
  const user = await requireUser();
  const t = await getTranslations("kb");
  const spaces = await listSpaces(kbViewerOf(user));
  // The form offers only what the action would accept.
  const manageable = canManageAnySpace(user.principal) ? (await listEntities()).filter((entity) => canManageSpace(user.principal, { entityId: entity.id })) : [];
  const groupWide = canManageSpace(user.principal, { entityId: null });
  const groups = [
    { key: "group", spaces: spaces.filter((space) => !space.entityId && !space.archivedAt) },
    { key: "entity", spaces: spaces.filter((space) => space.entityId && !space.archivedAt) },
    { key: "archived", spaces: spaces.filter((space) => space.archivedAt) },
  ].filter((group) => group.spaces.length > 0);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      {groups.length === 0 ? <p className="text-sm text-muted-foreground">{t("noSpaces")}</p> : null}
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t(`groups.${group.key}`)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.spaces.map((space) => (
              <Link key={space.id} href={`/kb/spaces/${space.key}`} className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span aria-hidden>{space.icon ?? "📄"}</span>
                      <span className="min-w-0 truncate">{space.name}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2">
                    {space.description ? <p className="line-clamp-2 text-sm text-muted-foreground">{space.description}</p> : null}
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="secondary">{t("space.pages", { count: space.pageCount })}</Badge>
                      {space.entityName ? <Badge variant="outline">{space.entityName}</Badge> : null}
                      {space.kind === "controlled" ? <Badge variant="outline">{t("space.kind.controlled")}</Badge> : null}
                      {space.level !== "view" ? <Badge variant="outline">{t(`level.${space.level}`)}</Badge> : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {groupWide || manageable.length > 0 ? (
        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-medium">{t("space.new")}</summary>
          <div className="pt-4">
            <NewSpaceForm entities={manageable.map((entity) => ({ id: entity.id, name: entity.shortName }))} groupWide={groupWide} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
