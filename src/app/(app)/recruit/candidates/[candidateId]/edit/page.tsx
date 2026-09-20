import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listPeople } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageCandidates, getCandidateView } from "@/modules/recruit/service";
import { CandidateForm } from "@/modules/recruit/ui/candidate-form";

export const metadata: Metadata = { title: "Edit candidate" };

export default async function EditCandidatePage({ params }: PageProps<"/recruit/candidates/[candidateId]/edit">) {
  const { candidateId } = await params;
  const user = await requireUser();
  if (!canManageCandidates(user.principal)) notFound();
  const view = await getCandidateView({ principal: user.principal, personId: user.person.id }, candidateId);
  if (!view) notFound();

  const people = (await listPeople(user.principal, {}, { pageSize: 500 })).rows.map((row) => ({ id: row.id, fullName: row.fullName }));
  const { candidate } = view;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{candidate.fullName}</h1>
      <CandidateForm
        value={{
          id: candidate.id,
          fullName: candidate.fullName,
          email: candidate.email,
          phone: candidate.phone,
          currentTitle: candidate.currentTitle,
          currentEmployer: candidate.currentEmployer,
          location: candidate.location,
          links: candidate.links,
          source: candidate.source,
          sourceDetail: candidate.sourceDetail,
          referredByPersonId: candidate.referredByPersonId,
          tags: candidate.tags,
          notes: candidate.notes,
        }}
        people={people}
      />
    </div>
  );
}
