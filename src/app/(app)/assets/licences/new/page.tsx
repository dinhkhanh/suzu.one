import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageLicences, canReadAssetMoney } from "@/modules/assets/service";
import { LicenceForm } from "@/modules/assets/ui/licence-forms";

export const metadata: Metadata = { title: "Bản quyền mới" };

export default async function NewLicencePage() {
  const user = await requireUser();
  if (!canManageLicences(user.principal)) notFound();
  const [entities, people, t] = await Promise.all([
    db().select({ id: schema.entity.id, code: schema.entity.code, shortName: schema.entity.shortName }).from(schema.entity).orderBy(asc(schema.entity.code)),
    db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.status, "active")).orderBy(asc(schema.person.fullName)),
    getTranslations("assets.licences"),
  ]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1>{t("nav.new")}</h1>
      <LicenceForm value={null} entities={entities} people={people} canSeeMoney={canReadAssetMoney(user.principal)} />
    </div>
  );
}
