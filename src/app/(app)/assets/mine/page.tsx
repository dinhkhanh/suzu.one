import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageAssets, canReadRegister, listAssetsOfPerson } from "@/modules/assets/service";
import { ConfirmHandoverForm } from "@/modules/assets/ui/asset-forms";
import { AssetsNav } from "@/modules/assets/ui/nav";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myEquipment");

// Everyone has this page, whatever their role: what the company has handed to them, and the
// confirmation that they received it (FR-AST-02).
export default async function MyAssetsPage() {
  const user = await requireUser();
  const [held, t] = await Promise.all([listAssetsOfPerson(user.person.id), getTranslations("assets.mine")]);

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
    </Page>
  );
}
