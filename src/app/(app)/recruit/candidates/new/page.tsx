import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { listPeople } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageCandidates } from "@/modules/recruit/service";
import { CandidateForm } from "@/modules/recruit/ui/candidate-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("addCandidate");

export default async function NewCandidatePage() {
  const user = await requireUser();
  if (!canManageCandidates(user.principal)) notFound();
  const t = await getTranslations("recruit");
  const people = (await listPeople(user.principal, {}, { pageSize: 500 })).rows.map((row) => ({ id: row.id, fullName: row.fullName }));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1>{t("newCandidate")}</h1>
      <CandidateForm value={null} people={people} />
    </div>
  );
}
