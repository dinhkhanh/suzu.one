import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { canActOnBooking, canDecideBookings, findBooking } from "@/modules/assets/service";
import { BookingStatusBadge, formatWindow } from "@/modules/assets/ui/booking-calendar";
import { CancelBookingForm, DecideBookingForm, MoveBookingForm } from "@/modules/assets/ui/booking-forms";

export const metadata: Metadata = { title: "Đặt thiết bị" };

// One booking. Shared gear is common property, so anybody signed in may read a booking of it; what
// they may *do* — confirm, call off, hand out, take back — is decided per person, here and again
// inside each action.
export default async function BookingPage({ params }: PageProps<"/assets/bookings/[bookingId]">) {
  const user = await requireUser();
  const { bookingId } = await params;
  const booking = await findBooking(bookingId);
  if (!booking) notFound();

  const t = await getTranslations("assets.bookings");
  const mayAct = canActOnBooking(user.principal, { personId: booking.personId, entityId: booking.assetEntityId });
  const mayDecide = canDecideBookings(user.principal, booking.assetEntityId);

  const facts: [string, string][] = [
    [t("columns.asset"), `${booking.assetCode} — ${booking.assetName}`],
    [t("columns.person"), booking.personName],
    [t("columns.window"), formatWindow(booking.startAt, booking.endAt)],
    [t("columns.purpose"), booking.purpose ?? "—"],
    [t("form.projectRef"), booking.projectRef ?? "—"],
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{booking.assetCode}</h1>
          <p className="text-sm text-muted-foreground">{booking.categoryName ?? booking.assetName}</p>
        </div>
        <div className="flex items-center gap-2">
          <BookingStatusBadge status={booking.status} />
          <Link href="/assets/bookings" className="h-9 rounded-md border px-3 text-sm leading-9">
            {t("nav.calendar")}
          </Link>
        </div>
      </header>

      <dl className="grid gap-x-6 gap-y-3 rounded-md border p-4 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        {booking.decisionNote ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("decide.reason")}</dt>
            <dd>{booking.decisionNote}</dd>
          </div>
        ) : null}
        {booking.checkedOutAt ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("move.checkedOutAt")}</dt>
            <dd>{formatWindow(booking.checkedOutAt, booking.checkedInAt ?? booking.checkedOutAt).split(" → ")[0]}</dd>
          </div>
        ) : null}
        {booking.checkedInAt ? (
          <div>
            <dt className="text-xs text-muted-foreground">{t("move.checkedInAt")}</dt>
            <dd>{formatWindow(booking.checkedInAt, booking.checkedInAt).split(" → ")[0]}</dd>
          </div>
        ) : null}
      </dl>

      {booking.status === "requested" && mayDecide ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">{t("decide.title")}</h2>
          <DecideBookingForm bookingId={booking.id} />
        </section>
      ) : null}

      {booking.status === "confirmed" && mayAct ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">{t("move.outTitle")}</h2>
          <MoveBookingForm bookingId={booking.id} direction="out" defaultCondition="good" />
        </section>
      ) : null}

      {booking.status === "checked_out" && mayAct ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">{t("move.inTitle")}</h2>
          <MoveBookingForm bookingId={booking.id} direction="in" defaultCondition={booking.conditionOut ?? "good"} />
        </section>
      ) : null}

      {mayAct && (booking.status === "requested" || booking.status === "confirmed") ? <CancelBookingForm bookingId={booking.id} /> : null}
    </div>
  );
}
