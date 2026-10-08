import { asc, eq } from "drizzle-orm";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { db, schema } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { TableAddRow, TableCard, TableCardHeader } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canBookAssets, canDecideBookings, canManageAssets, listBookableAssets, listBookingRequests, listBookings, listBookingsOfPerson, listCategories, shiftWeeks, weekStart } from "@/modules/assets/service";
import { BookingCalendarFilters, BookingList, BookingWeek } from "@/modules/assets/ui/booking-calendar";
import { BookAssetForm } from "@/modules/assets/ui/booking-forms";
import { AssetsNav } from "@/modules/assets/ui/nav";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("equipmentBookings");

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
    listEntities(),
    listBookingsOfPerson(user.person.id),
    canDecideBookings(user.principal) ? listBookingRequests(user.principal) : Promise.resolve([]),
    getTranslations("assets.bookings"),
  ]);

  // Booking on somebody's behalf is the keeper's privilege; nobody else is offered the list.
  const people = canDecideBookings(user.principal) ? await db().select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(eq(schema.person.status, "active")).orderBy(asc(schema.person.fullName)) : [];

  const link = (weeks: number) => {
    const params = new URLSearchParams();
    params.set("week", isoMonday(shiftWeeks(weekBegins, weeks)));
    if (filter.categoryId) params.set("categoryId", filter.categoryId);
    if (filter.entityId) params.set("entityId", filter.entityId);
    return `/assets/bookings?${params.toString()}`;
  };
  const weekLabel = t("week.of", { date: isoMonday(weekBegins).split("-").reverse().join("/") });

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button nativeButton={false} variant="outline" render={<Link href="/assets/mine" />}>
            {t("nav.mine")}
          </Button>
        }
      />
      <AssetsNav current="bookings" manages={canManageAssets(user.principal)} principal={user.principal} />

      <BookingCalendarFilters query={{ ...filter, week: isoMonday(weekBegins) }} categories={categories} entities={entities} />

      <Section
        title={weekLabel}
        action={
          <span className="flex items-center gap-1">
            <Button nativeButton={false} variant="ghost" size="icon-sm" render={<Link href={link(-1)} aria-label={t("week.previous")} />}>
              <ChevronLeftIcon />
            </Button>
            <Button nativeButton={false} variant="ghost" size="icon-sm" render={<Link href={link(1)} aria-label={t("week.next")} />}>
              <ChevronRightIcon />
            </Button>
          </span>
        }
      >
        <BookingWeek weekBegins={weekBegins} assets={assets} bookings={bookings} />
      </Section>

      {waiting.length > 0 ? (
        <TableCard>
          <TableCardHeader title={t("waiting")} count={waiting.length} />
          <BookingList rows={waiting} empty={t("noneWaiting")} />
        </TableCard>
      ) : null}

      <TableCard>
        <TableCardHeader title={t("mine")} count={mine.length || null} />
        <BookingList rows={mine} empty={t("noneMine")} />
        {canBookAssets(user.principal) && assets.length > 0 ? (
          <TableAddRow label={t("form.title")} open={mine.length === 0}>
            <BookAssetForm assets={assets.map((asset) => ({ id: asset.id, code: asset.code, name: asset.name, categoryName: asset.categoryName }))} people={people} canBookForOthers={canDecideBookings(user.principal)} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
