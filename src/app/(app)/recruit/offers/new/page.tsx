import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { listOfferTemplates } from "@/modules/recruit/offers";
import { canMakeOffer } from "@/modules/recruit/policy";
import { getApplicationView } from "@/modules/recruit/service";
import { interviewerOptions } from "@/modules/recruit/interviews";
import { OfferForm } from "@/modules/recruit/ui/offer-forms";

export const metadata: Metadata = { title: "New offer" };

// Drafting the offer for one application. Everything the opening already knows is prefilled, so
// the only things anybody types are the ones that were actually negotiated.
export default async function NewOfferPage({ searchParams }: PageProps<"/recruit/offers/new">) {
  const { applicationId } = await searchParams;
  const user = await requireUser();
  if (typeof applicationId !== "string") notFound();

  const view = await getApplicationView({ principal: user.principal, personId: user.person.id }, applicationId);
  if (!view) notFound();
  const target = { entityId: view.opening.entityId, departmentId: view.opening.departmentId, teamId: view.opening.teamId };
  // Making an offer is the money authority: a recruiter reaching this URL gets the same answer as
  // an application that does not exist.
  if (!canMakeOffer(user.principal, target)) notFound();

  const t = await getTranslations("recruit.offer");
  const [templates, managers] = await Promise.all([listOfferTemplates(), interviewerOptions(view.opening.id)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <h1>{t("newTitle", { name: view.candidate.fullName })}</h1>
        <p className="text-sm text-muted-foreground">
          {view.opening.title} · {view.opening.code}
        </p>
      </header>
      <OfferForm
        applicationId={applicationId}
        managers={managers.map((person) => ({ id: person.personId, name: person.fullName }))}
        templates={templates.map((template) => ({ id: template.id, name: template.name }))}
        canSetMoney
        values={{
          positionName: view.opening.positionName ?? view.opening.title,
          jobLevel: view.opening.jobLevel,
          employmentType: view.opening.employmentType,
          workLocation: view.opening.workLocation,
          managerPersonId: null,
          startDate: view.opening.targetStartDate ?? "",
          expiresOn: null,
          probationMonths: 2,
          probationSalaryPercent: 85,
          // Never prefilled from the candidate's expectation: an offer is a decision, not an echo.
          baseSalaryVnd: null,
          allowancesVnd: 0,
          letterTemplateId: templates[0]?.id ?? null,
          note: null,
        }}
      />
    </div>
  );
}
