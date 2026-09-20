import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { listPeople } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { canFileHiringRequest, canSetRecruitMoney } from "@/modules/recruit/service";
import { HiringRequestForm } from "@/modules/recruit/ui/hiring-forms";

export const metadata: Metadata = { title: "Request a hire" };

export default async function NewHiringRequestPage() {
  const user = await requireUser();
  if (!canFileHiringRequest(user.principal)) notFound();
  const t = await getTranslations("recruit");
  const [entities, departments, people] = await Promise.all([
    db().select().from(schema.entity).orderBy(asc(schema.entity.code)),
    db().select({ id: schema.department.id, name: schema.department.name }).from(schema.department).orderBy(asc(schema.department.name)),
    listPeople(user.principal, {}, { pageSize: 500 }),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("newHiring")}</h1>
      <HiringRequestForm
        entities={entities}
        departments={departments}
        people={people.rows.map((row) => ({ id: row.id, fullName: row.fullName }))}
        canSetMoney={canSetRecruitMoney(user.principal)}
        defaultEntityId={user.person.primaryEntityId}
        defaultDepartmentId={user.person.departmentId}
      />
    </div>
  );
}
