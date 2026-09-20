import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { getOfferView, listOfferTemplates } from "@/modules/recruit/offers";
import { interviewerOptions } from "@/modules/recruit/interviews";
import { OfferForm } from "@/modules/recruit/ui/offer-forms";

export const metadata: Metadata = { title: "Edit offer" };

// Correcting a draft. `canEdit` is false the moment the offer goes for approval, and the service
// refuses the update as well — a stale tab cannot rewrite a figure an approver is looking at.
export default async function EditOfferPage({ params }: PageProps<"/recruit/offers/[offerId]/edit">) {
  const { offerId } = await params;
  const user = await requireUser();
  const view = await getOfferView({ principal: user.principal, personId: user.person.id }, offerId);
  if (!view?.canEdit) notFound();

  const t = await getTranslations("recruit.offer");
  const [templates, managers] = await Promise.all([listOfferTemplates(), interviewerOptions(view.offer.openingId)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("editTitle", { name: view.candidateName })}</h1>
        <p className="text-sm text-muted-foreground">{view.offer.number}</p>
      </header>
      <OfferForm
        offerId={offerId}
        managers={managers.map((person) => ({ id: person.personId, name: person.fullName }))}
        templates={templates.map((template) => ({ id: template.id, name: template.name }))}
        canSetMoney={!!view.money}
        values={{
          positionName: view.offer.positionName,
          jobLevel: view.offer.jobLevel,
          employmentType: view.offer.employmentType,
          workLocation: view.offer.workLocation,
          managerPersonId: view.offer.managerPersonId,
          startDate: view.offer.startDate,
          expiresOn: view.offer.expiresOn,
          probationMonths: view.offer.probationMonths,
          probationSalaryPercent: view.offer.probationSalaryPercent,
          baseSalaryVnd: view.money?.baseSalaryVnd ?? null,
          allowancesVnd: view.money?.allowancesVnd ?? null,
          letterTemplateId: view.offer.letterTemplateId,
          note: view.offer.note,
        }}
      />
    </div>
  );
}
