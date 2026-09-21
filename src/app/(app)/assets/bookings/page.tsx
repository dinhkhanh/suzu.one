import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canBookAssets, canDecideBookings, listBookableAssets, listBookingRequests, listBookings, listBookingsOfPerson, listCategories, shiftWeeks, weekStart } from "@/modules/assets/service";
import { BookingCalendarFilters, BookingList, BookingWeek } from "@/modules/assets/ui/booking-calendar";
import { BookAssetForm } from "@/modules/assets/ui/booking-forms";

export const metadata: Metadata = { title: "Lịch đặt thiết bị" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The booking calendar (FR-AST-03). Shared production gear is common property — see `canViewAsset`
// — so any signed-in person reaches this page; what they may *do* is decided per booking.
export default async function BookingsPage({ searchParams }: PageProps<"/assets/bookings">) {
  const user = await requireUser();
  const query = await searchParams;

  // ?week= is the Monday being looked at; absent means this week.
  const anchor = one(query.week) ? new Date(`${one(query.week)}T00:00:00+07:00`) : new Date();
  const weekBegins = weekStart(Number.isNaN(anchor.getTime()) ? new Date() : anchor);
  const weekEnds = shiftWeeks(weekBegins, 1);
  const isoMonday = (value: Date) => new Date(value.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

  const filter = { categoryId: one(query.categoryId), entityId: one(query.entityId) };
  const [assets, bookings, categories, entities, mine, waiting, t] = await Promise.all([
    listBookableAssets(filter),
    listBookings({ from: weekBegins, to: weekEnds, ...filter }),
    listCategories().then((rows) => rows.filter((row) => row.bookable && row.isActive)),
    db().select().from(schema.entity).orderBy(asc(schema.entity.code)),
    listBookingsOfPerson(user.person.id),
    canDecideBookings(user.principal) ? listBookingRequests(user.principal) : Promise.resolve([]),
    getTranslations("assets.bookings"),
  ]);

  // Booking on somebody's behalf is the keeper's privilege; nobody else is offered the list.
  const people = canDecideBookings(user.principal)
    ? await db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.status, "active")).orderBy(asc(schema.person.fullName))
    : [];

  const link = (weeks: number) => {
    const params = new URLSearchParams();
    params.set("week", isoMonday(shiftWeeks(weekBegins, weeks)));
    if (filter.categoryId) params.set("categoryId", filter.categoryId);
    if (filter.entityId) params.set("entityId", filter.entityId);
    return `/assets/bookings?${params.toString()}`;
  };

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/assets/mine" className="h-9 rounded-md border px-3 text-sm leading-9">
          {t("nav.mine")}
        </Link>
      </header>

      <BookingCalendarFilters query={{ ...filter, week: isoMonday(weekBegins) }} categories={categories} entities={entities} />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Link href={link(-1)} className="h-8 rounded-md border px-3 text-sm leading-8">
            ← {t("week.previous")}
          </Link>
          <p className="text-sm font-medium">{t("week.of", { date: isoMonday(weekBegins).split("-").reverse().join("/") })}</p>
          <Link href={link(1)} className="h-8 rounded-md border px-3 text-sm leading-8">
            {t("week.next")} →
          </Link>
        </div>
        <BookingWeek weekBegins={weekBegins} assets={assets} bookings={bookings} />
      </section>

      {waiting.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2>{t("waiting")}</h2>
          <BookingList rows={waiting} empty={t("noneWaiting")} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2>{t("mine")}</h2>
        <BookingList rows={mine} empty={t("noneMine")} />
      </section>

      {canBookAssets(user.principal) && assets.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2>{t("form.title")}</h2>
          <BookAssetForm assets={assets.map((asset) => ({ id: asset.id, code: asset.code, name: asset.name, categoryName: asset.categoryName }))} people={people} canBookForOthers={canDecideBookings(user.principal)} />
        </section>
      ) : null}
    </div>
  );
}
