// What the calendar adapter managed to do. Plain module: the drivers are `server-only`, but the
// status is written on rows and read by pages, so it lives where both sides may import it.
//
// `simulated` is the honest answer on a machine with no Google credentials: our own row exists,
// whatever file or page hangs off it works, and nothing left the building. A screen that shows
// this status says so rather than pretending an invitation went out.
export const CALENDAR_DELIVERY_STATUSES = ["simulated", "sent", "failed"] as const;
export type CalendarDeliveryStatus = (typeof CALENDAR_DELIVERY_STATUSES)[number];
