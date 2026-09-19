import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { listRollouts } from "@/modules/platform/flags/service";
import { RolloutForm } from "@/modules/platform/flags/ui/rollout-form";
import { listDepartments, listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Rollout" };

export default async function FlagsPage() {
  const user = await requireUser();
  if (!can(user.principal, "org:manage", {})) notFound();

  const t = await getTranslations("flags");
  const [rollouts, entities, departments, people] = await Promise.all([listRollouts(), listEntities(), listDepartments(), listPersonNames()]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      {rollouts.map(({ key, rollout }) => (
        <RolloutForm
          key={key}
          flag={key}
          rollout={rollout}
          entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))}
          departments={departments.filter((department) => department.isActive).map((department) => ({ id: department.id, name: department.name }))}
          people={people.map((person) => ({ id: person.id, name: person.fullName }))}
        />
      ))}
    </div>
  );
}
