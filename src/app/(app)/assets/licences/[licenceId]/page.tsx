import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canManageLicences, canReadAssetMoney, findLicence } from "@/modules/assets/service";
import { LicenceForm } from "@/modules/assets/ui/licence-forms";

export const metadata: Metadata = { title: "Bản quyền" };

export default async function LicencePage({ params }: PageProps<"/assets/licences/[licenceId]">) {
  const user = await requireUser();
  const { licenceId } = await params;
  const licence = await findLicence(licenceId);
  // Not there, or not this viewer's entity — the same answer either way.
  if (!licence || !canManageLicences(user.principal, licence.entityId)) notFound();

  const [entities, people, t] = await Promise.all([
    listEntities().then((rows) => rows.map(({ id, code, shortName }) => ({ id, code, shortName }))),
    db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.status, "active")).orderBy(asc(schema.person.fullName)),
    getTranslations("assets.licences"),
  ]);
  const canSeeMoney = canReadAssetMoney(user.principal, licence.entityId);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1>{licence.name}</h1>
      <LicenceForm
        value={{
          id: licence.id,
          name: licence.name,
          vendor: licence.vendor,
          entityId: licence.entityId,
          seats: licence.seats,
          costPerCycle: canSeeMoney ? licence.costPerCycle : null,
          billingCycle: licence.billingCycle,
          renewalDate: licence.renewalDate,
          autoRenews: licence.autoRenews,
          ownerPersonId: licence.ownerPersonId,
          accountRef: licence.accountRef,
          notes: licence.notes,
          status: licence.status,
        }}
        entities={entities}
        people={people}
        canSeeMoney={canSeeMoney}
      />
      <p className="text-xs text-muted-foreground">{t("trackerNote")}</p>
    </div>
  );
}
