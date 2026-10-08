import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { listPeople } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, listOrgUnits } from "@/modules/platform/org/service";
import { canFileHiringRequest, canSetRecruitMoney } from "@/modules/recruit/service";
import { HiringRequestForm } from "@/modules/recruit/ui/hiring-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("requestAHire");

const param = (value: string | string[] | undefined, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : undefined);

/** `?title=&start=&reason=` prefill the form — the CRM's staffing check links here (FR-CRM-17). */
export default async function NewHiringRequestPage({ searchParams }: PageProps<"/recruit/hiring/new">) {
  const user = await requireUser();
  if (!canFileHiringRequest(user.principal)) notFound();
  const t = await getTranslations("recruit");
  const query = await searchParams;
  const start = param(query.start, 10);
  const prefill = { positionTitle: param(query.title, 200), targetStartDate: start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : undefined, reason: param(query.reason, 2000) };
  const [entities, departments, people] = await Promise.all([listEntities(), listOrgUnits().then((units) => units.map((unit) => ({ id: unit.id, name: unit.name }))), listPeople(user.principal, {}, { pageSize: 500 })]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1>{t("newHiring")}</h1>
      <HiringRequestForm
        entities={entities}
        departments={departments}
        people={people.rows.map((row) => ({ id: row.id, fullName: row.fullName }))}
        canSetMoney={canSetRecruitMoney(user.principal)}
        defaultEntityId={user.person.primaryEntityId}
        defaultDepartmentId={user.person.departmentId}
        prefill={prefill}
      />
    </div>
  );
}
