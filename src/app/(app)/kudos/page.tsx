import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { canRemoveKudos, listCompanyValues, listKudos, listKudosRecipients } from "@/modules/comms/service";
import { RemoveKudosButton } from "@/modules/comms/ui/buttons";
import { KudosList } from "@/modules/comms/ui/cards";
import { KudosForm } from "@/modules/comms/ui/kudos-form";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Kudos" };

export default async function KudosPage() {
  const user = await requireUser();
  // Kudos are about the people in the directory; collaborators have none.
  if (user.principal.workforceType === "collaborator") notFound();
  const t = await getTranslations("comms");
  const locale = await getLocale();
  const [wall, mine, people, values] = await Promise.all([listKudos({ limit: 60 }), listKudos({ toPersonId: user.person.id, limit: 30 }), listKudosRecipients(user.person.id), listCompanyValues()]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1>{t("kudos.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("kudos.help")}</p>
      </header>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("kudos.giveTitle")}</h2>
        <KudosForm people={people} values={values.map((value) => ({ key: value.key, name: locale === "en" ? value.nameEn : value.nameVi }))} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("kudos.mine")}</h2>
        <KudosList cards={mine} empty={t("kudos.mineEmpty")} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("kudos.wall")}</h2>
        <KudosList
          cards={wall}
          empty={t("kudos.empty")}
          action={(card) => (canRemoveKudos(user.principal, card, { entityId: card.toEntityId, unitPath: card.toUnitPath, personId: card.toPersonId }) ? <RemoveKudosButton id={card.id} /> : null)}
        />
      </section>
    </div>
  );
}
