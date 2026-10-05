import { ExternalLinkIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { pageTitle } from "@/i18n/page-title";
import { todayInVietnam } from "@/lib/dates";
import { publicOrigin } from "@/lib/site";
import { hasThumbnail } from "@/modules/brand/engine/kit";
import { canManageBrandKit } from "@/modules/brand/policy";
import { downloadTotalsByAsset, findBrandKit, loadBrandKitContent } from "@/modules/brand/service";
import { AssetRowForm, UploadAssetsForm } from "@/modules/brand/ui/asset-forms";
import { DeleteKitButton, KitDetailsForm, KitStyleForm } from "@/modules/brand/ui/kit-forms";
import { AddSectionForm, SectionEditor } from "@/modules/brand/ui/section-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const generateMetadata = pageTitle("brand");

const VISIBILITY_TONE = { hidden: "outline", unlisted: "info", listed: "success" } as const;

// One brand kit, as its keeper writes it (FR-BRD-01..05): the details and the address, the palette
// and the typefaces, the guideline section by section with its do's and don'ts, and the files.
export default async function BrandKitPage({ params }: PageProps<"/admin/brands/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const kit = await findBrandKit(id);
  if (!kit || !canManageBrandKit(user.principal, kit)) notFound();

  const [t, content, entities, downloads] = await Promise.all([getTranslations("brands"), loadBrandKitContent(kit), listEntities(), downloadTotalsByAsset(kit.id, todayInVietnam())]);
  const creatableEntities = entities.filter((entity) => (entity.isActive && canManageBrandKit(user.principal, { entityId: entity.id })) || entity.id === kit.entityId).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const allowGroup = canManageBrandKit(user.principal, { entityId: null });
  const origin = publicOrigin();
  const sectionOptions = content.sections.map((section) => ({ id: section.id, title: section.title }));
  const examples = content.assets.filter((asset) => hasThumbnail(asset.fileName)).map((asset) => ({ id: asset.id, title: asset.title }));

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/admin/brands" className="hover:text-foreground">
            {t("title")}
          </Link>
        }
        title={
          <span className="flex min-w-0 items-center gap-3">
            <span className="min-w-0 truncate">{kit.name}</span>
            <Badge dot variant={VISIBILITY_TONE[kit.visibility]}>
              {t(`visibilities.${kit.visibility}`)}
            </Badge>
          </span>
        }
        description={kit.tagline ?? undefined}
        actions={
          kit.visibility === "hidden" ? null : (
            <a href={`${origin}/brands/${kit.slug}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "outline", className: "w-full md:w-auto" })}>
              <ExternalLinkIcon />
              {t("openPublic")}
            </a>
          )
        }
      />

      <Section title={t("details")}>
        <Card>
          <CardContent>
            <KitDetailsForm kit={kit} origin={origin} entities={creatableEntities} allowGroup={allowGroup} />
          </CardContent>
        </Card>
      </Section>

      <Section title={t("style")} description={t("styleHint")}>
        <Card>
          <CardContent>
            <KitStyleForm kit={kit} />
          </CardContent>
        </Card>
      </Section>

      <Section title={t("guideline")} description={t("guidelineHint")} count={content.sections.length}>
        <div className="flex flex-col gap-4">
          {content.sections.length === 0 ? <p className="text-sm text-muted-foreground">{t("noSections")}</p> : null}
          {content.sections.map((section, index) => (
            <Card key={section.id} id={`section-${section.id}`}>
              <CardContent>
                <SectionEditor section={section} rules={content.rules.filter((rule) => rule.sectionId === section.id)} examples={examples} index={index} count={content.sections.length} />
              </CardContent>
            </Card>
          ))}
          <TableCard>
            <TableAddRow label={t("addSection")} open={content.sections.length === 0}>
              <AddSectionForm kitId={kit.id} />
            </TableAddRow>
          </TableCard>
        </div>
      </Section>

      <Section title={t("filesSection")} description={t("filesSectionHint")} count={content.assets.length}>
        <TableCard>
          <List>
            {content.assets.length === 0 ? <ListEmpty>{t("noFiles")}</ListEmpty> : null}
            {content.assets.map((asset) => (
              <ListItem key={asset.id} className="py-3">
                <AssetRowForm asset={asset} sections={sectionOptions} downloads={downloads.get(asset.id) ?? null} pictureUrl={`/admin/brands/${kit.id}/files/${asset.id}`} />
              </ListItem>
            ))}
          </List>
          <TableAddRow label={t("addFiles")} open={content.assets.length === 0}>
            <UploadAssetsForm kitId={kit.id} sections={sectionOptions} />
          </TableAddRow>
        </TableCard>
      </Section>

      <Section title={t("danger")}>
        <Card>
          <CardContent>{content.assets.length === 0 ? <DeleteKitButton kitId={kit.id} /> : <p className="text-sm text-muted-foreground">{t("deleteKitHasFiles")}</p>}</CardContent>
        </Card>
      </Section>
    </Page>
  );
}
