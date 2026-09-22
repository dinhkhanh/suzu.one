import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities, listOrgUnits } from "@/modules/platform/org/service";
import { canBookAssets, canConfirmHandover, canManageAssets, getAssetView, listBookings, listCategories } from "@/modules/assets/service";
import { AssignForm, ConfirmHandoverForm, ReturnForm, StatusForm } from "@/modules/assets/ui/asset-forms";
import { BookingList } from "@/modules/assets/ui/booking-calendar";
import { BookAssetForm } from "@/modules/assets/ui/booking-forms";
import { AssetHistory, AssetQr, StatusBadge } from "@/modules/assets/ui/register-views";

export const metadata: Metadata = { title: "Tài sản" };

export default async function AssetPage({ params }: PageProps<"/assets/[assetId]">) {
  const user = await requireUser();
  const { assetId } = await params;
  const view = await getAssetView(user.principal, assetId);
  // Not there, or not theirs — the same answer either way.
  if (!view) notFound();

  const manage = canManageAssets(user.principal, view.asset.entityId);
  const open = view.spells.find((spell) => !spell.returnedAt);
  const mine = canConfirmHandover(user.principal, open?.holderPersonId ?? null) && !open?.handoverConfirmedAt;
  // Shared production gear carries its own booking panel; ordinary equipment does not.
  const bookable = view.bookable;
  const from = new Date();
  const [t, tField, tBooking, upcoming, [people, teams, entities, categories]] = await Promise.all([
    getTranslations("assets"),
    getTranslations("assets.form"),
    getTranslations("assets.bookings"),
    bookable ? listBookings({ from, to: new Date(from.getTime() + 90 * 86_400_000), assetId }) : [],
    manage
      ? Promise.all([
          db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.status, "active")).orderBy(asc(schema.person.fullName)),
          listOrgUnits().then((units) => units.map(({ id, name }) => ({ id, name }))),
          listEntities().then((rows) => rows.map(({ id, code, shortName }) => ({ id, code, shortName }))),
          listCategories(),
        ])
      : [[], [], [], []],
  ]);

  const fact = (label: string, value: string | number | null) =>
    value === null || value === "" ? null : (
      <div key={label}>
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="text-sm">{typeof value === "number" ? value.toLocaleString("vi-VN") : value}</dd>
      </div>
    );

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{view.asset.code}</p>
          <h1>{view.asset.name}</h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge status={view.asset.status} />
            {view.asset.categoryName} · {view.asset.entityName}
          </p>
        </div>
        <AssetQr url={`${env().BETTER_AUTH_URL}/assets/qr/${view.qrToken}`} />
      </header>

      <dl className="grid grid-cols-2 gap-4 rounded-md border p-4 sm:grid-cols-4">
        {fact(tField("brand"), view.asset.brand)}
        {fact(tField("model"), view.asset.model)}
        {fact(tField("serial"), view.asset.serial)}
        {fact(tField("condition"), view.asset.condition)}
        {fact(tField("location"), view.asset.location)}
        {fact(tField("warrantyUntil"), view.asset.warrantyUntil)}
        {view.canSeeMoney ? fact(tField("purchaseDate"), view.asset.purchaseDate) : null}
        {view.canSeeMoney ? fact(tField("purchasePrice"), view.asset.purchasePrice) : null}
        {view.canSeeMoney ? fact(tField("supplier"), view.asset.supplier) : null}
      </dl>

      {open ? (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="font-medium">{t("held.title")}</h2>
          <p className="text-sm">
            {t("held.by", { holder: open.holderName ?? "—" })} · {open.assignedAt.toLocaleDateString("vi-VN")}
            {open.handoverConfirmedAt ? <span className="ml-2 text-emerald-600">{t("held.confirmed")}</span> : <span className="ml-2 text-amber-600">{t("held.awaitingConfirmation")}</span>}
          </p>
          {open.accessories.length > 0 ? <p className="text-sm text-muted-foreground">{open.accessories.join(" · ")}</p> : null}
          {mine ? <ConfirmHandoverForm assignmentId={open.id} /> : null}
          {manage ? <ReturnForm assignmentId={open.id} /> : null}
        </section>
      ) : manage ? (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="font-medium">{t("assign.title")}</h2>
          <AssignForm assetId={assetId} options={{ people, teams, entities }} />
        </section>
      ) : null}

      {manage ? (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <h2 className="font-medium">{t("status.title")}</h2>
          <StatusForm assetId={assetId} status={view.asset.status} />
          <Link href={`/assets/${assetId}/edit`} className="text-sm underline">
            {t("nav.edit")}
          </Link>
        </section>
      ) : null}

      {bookable ? (
        <section className="flex flex-col gap-3 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">{tBooking("title")}</h2>
            <Link href="/assets/bookings" className="text-sm underline">
              {tBooking("nav.calendar")}
            </Link>
          </div>
          <BookingList rows={upcoming} empty={tBooking("noneMine")} showAsset={false} />
          {canBookAssets(user.principal) ? <BookAssetForm assets={[]} assetId={assetId} people={people} canBookForOthers={manage} /> : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">{t("history")}</h2>
        <AssetHistory entries={view.history} />
      </section>

      {categories.length > 0 ? null : null}
    </div>
  );
}
