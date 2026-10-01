import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { canRemoveKudos, listCompanyValues, listKudos, listKudosRecipients } from "@/modules/comms/service";
import { RemoveKudosButton } from "@/modules/comms/ui/buttons";
import { KudosCards } from "@/modules/comms/ui/cards";
import { KudosForm } from "@/modules/comms/ui/kudos-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("kudos");

export default async function KudosPage() {
  const user = await requireUser();
  // Kudos are about the people in the directory; collaborators have none.
  if (user.principal.workforceType === "collaborator") notFound();
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const [wall, mine, people, values] = await Promise.all([listKudos({ limit: 60 }), listKudos({ toPersonId: user.person.id, limit: 30 }), listKudosRecipients(user.person.id), listCompanyValues()]);

  return (
    <Page>
      <PageHeader title={t("kudos.title")} description={t("kudos.help")} />
      <Section title={t("kudos.giveTitle")}>
        <Card>
          <CardContent>
            <KudosForm people={people} values={values.map((value) => ({ key: value.key, name: locale === "en" ? value.nameEn : value.nameVi }))} />
          </CardContent>
        </Card>
      </Section>
      <Section title={t("kudos.mine")} count={mine.length || undefined}>
        <KudosCards cards={mine} empty={t("kudos.mineEmpty")} />
      </Section>
      <Section title={t("kudos.wall")} count={wall.length || undefined}>
        <KudosCards
          cards={wall}
          empty={t("kudos.empty")}
          action={(card) => (canRemoveKudos(user.principal, card, { entityId: card.toEntityId, unitPath: card.toUnitPath, personId: card.toPersonId }) ? <RemoveKudosButton id={card.id} /> : null)}
        />
      </Section>
    </Page>
  );
}
