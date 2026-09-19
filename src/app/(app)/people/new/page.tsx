import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { canHireInto } from "@/modules/core-hr/policy";
import { loadPlacementOptions } from "@/modules/core-hr/service";
import { HireForm } from "@/modules/core-hr/ui/hire-form";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const metadata: Metadata = { title: "New person" };

export default async function NewPersonPage() {
  const user = await requireUser();
  const entities = (await listEntities()).filter((entity) => entity.isActive && canHireInto(user.principal, { entityId: entity.id }));
  if (entities.length === 0) notFound();

  const t = await getTranslations("people");
  const options = await loadPlacementOptions();

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("hire.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("hire.description")}</p>
      </header>
      <HireForm entities={entities.map(({ id, shortName }) => ({ id, name: shortName }))} options={options} today={todayInVietnam()} />
    </div>
  );
}
