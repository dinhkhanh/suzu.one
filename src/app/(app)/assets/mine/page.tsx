import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageAssets, canReadRegister, listAssetsOfPerson, listDigitalAccessOfPerson, listDigitalAssetsOwnedBy, listSeatsOfPerson } from "@/modules/assets/service";
import { PlatformBadge } from "@/modules/assets/ui/digital-views";
import { ConfirmHandoverForm } from "@/modules/assets/ui/asset-forms";
import { AssetsNav } from "@/modules/assets/ui/nav";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myEquipment");

// Everyone has this page, whatever their role: what the company has handed to them and the
// confirmation that they received it (FR-AST-02), the pages and channels they can get into or
// answer for (FR-AST-08), and the software they have a seat of (FR-AST-11).
export default async function MyAssetsPage() {
  const user = await requireUser();
  const [held, access, owned, seats, t, tDigital] = await Promise.all([
    listAssetsOfPerson(user.person.id),
    listDigitalAccessOfPerson(user.person.id),
    listDigitalAssetsOwnedBy(user.person.id),
    listSeatsOfPerson(user.person.id),
    getTranslations("assets.mine"),
    getTranslations("assets.digital"),
  ]);
  // What they answer for and also hold access to is listed once, as theirs to answer for.
  const ownedIds = new Set(owned.map((asset) => asset.id));

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canReadRegister(user.principal) ? (
            <Button nativeButton={false} variant="outline" render={<Link href="/assets" />}>
              {t("register")}
            </Button>
          ) : null
        }
      />
      <AssetsNav current="mine" manages={canManageAssets(user.principal)} principal={user.principal} />

      <List>
        {held.length === 0 ? <ListEmpty>{t("empty")}</ListEmpty> : null}
        {held.map((item) => (
          <ListItem key={item.assignmentId} className="flex-col items-stretch gap-3 py-4">
            <div>
              <p className="font-mono text-xs text-faint">{item.code}</p>
              <p className="font-medium">{item.name}</p>
              <p className="text-sm text-muted-foreground">
                {item.categoryName} · {t("since", { date: item.assignedAt.toLocaleDateString("vi-VN") })}
                {item.dueBack ? ` · ${t("dueBack", { date: item.dueBack })}` : ""}
              </p>
              {item.accessories.length > 0 ? <p className="text-sm text-muted-foreground">{item.accessories.join(" · ")}</p> : null}
            </div>
            {item.handoverConfirmedAt ? <p className="text-sm text-success">{t("confirmed", { date: item.handoverConfirmedAt.toLocaleDateString("vi-VN") })}</p> : <ConfirmHandoverForm assignmentId={item.assignmentId} />}
          </ListItem>
        ))}
      </List>

      <Section title={t("digital.title")} count={owned.length + access.filter((row) => !ownedIds.has(row.assetId)).length || null} action={<Link href="/assets/digital">{t("digital.directory")}</Link>}>
        <List>
          {owned.length === 0 && access.length === 0 ? <ListEmpty>{t("digital.empty")}</ListEmpty> : null}
          {owned.map((asset) => (
            <ListItem key={asset.id} href={`/assets/digital/${asset.id}`} className="flex-wrap gap-x-3 gap-y-1">
              <PlatformBadge platform={asset.platform} />
              <span className="min-w-0 flex-1 truncate font-medium">{asset.name}</span>
              <Badge variant="violet">{t("digital.owner")}</Badge>
            </ListItem>
          ))}
          {access
            .filter((row) => !ownedIds.has(row.assetId))
            .map((row) => (
              <ListItem key={row.accessId} href={`/assets/digital/${row.assetId}`} className="flex-wrap gap-x-3 gap-y-1">
                <PlatformBadge platform={row.platform} />
                <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                <Badge dot variant={row.status === "requested" ? "warning" : "success"}>
                  {row.status === "requested" ? tDigital("access.status.requested") : tDigital(`level.${row.level}`)}
                </Badge>
              </ListItem>
            ))}
        </List>
      </Section>

      <Section title={t("software.title")} count={seats.length || null}>
        <List>
          {seats.length === 0 ? <ListEmpty>{t("software.empty")}</ListEmpty> : null}
          {seats.map((seat) => (
            <ListItem key={seat.seatId} className="flex-wrap gap-x-3 gap-y-0.5">
              <span className="min-w-0 flex-1 truncate font-medium">{seat.name}</span>
              <span className="text-xs text-muted-foreground">{[seat.vendor, seat.viaAsset ? t("software.onDevice", { device: `${seat.viaAsset.code} ${seat.viaAsset.name}` }) : null].filter(Boolean).join(" · ")}</span>
            </ListItem>
          ))}
        </List>
      </Section>
    </Page>
  );
}
