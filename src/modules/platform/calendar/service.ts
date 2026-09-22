// The company calendar, as the rest of the app sees it (FR-REC-06 for interviews, FR-PJM-30 for
// project meetings). The driver behind it is chosen by configuration and may be the local one,
// which records "simulated" and sends nothing; callers store what came back and their pages say
// so, because a screen claiming an invitation went out when none did is worse than no integration.
import "server-only";
import { calendarDriver, type CalendarEvent, type CalendarResult } from "./driver";
import type { CalendarDeliveryStatus } from "./enums";

export type { CalendarAttendee, CalendarDriver, CalendarEvent, CalendarResult } from "./driver";
export { calendarDriver } from "./driver";
export { CALENDAR_DELIVERY_STATUSES, type CalendarDeliveryStatus } from "./enums";

/** What a caller writes on its own row: which driver ran, how it went, and what it got back. */
export type CalendarDelivery = {
  driver: "google" | "local";
  status: CalendarDeliveryStatus;
  /** The event id to keep, so the next change updates that event rather than making a second one. */
  eventId: string | null;
  meetingUrl: string | null;
  error: string | null;
};

const delivery = (driver: "google" | "local", result: CalendarResult, keptEventId: string | null): CalendarDelivery => ({
  driver,
  status: result.status,
  // A failed push must not throw away the id of the event that is still out there.
  eventId: result.status === "sent" ? result.eventId : keptEventId,
  meetingUrl: result.status === "sent" ? result.meetingUrl : null,
  error: result.status === "failed" ? result.error.slice(0, 500) : null,
});

/**
 * Puts an event in the calendar, or rewrites the one this row already has. Never throws: a
 * calendar that is down must not lose a meeting everybody has already agreed to, so the outcome
 * comes back to be stored beside the row.
 */
export async function putInCalendar(event: CalendarEvent, existingEventId: string | null = null): Promise<CalendarDelivery> {
  const driver = calendarDriver();
  const result = existingEventId ? await driver.update(existingEventId, event) : await driver.create(event);
  return delivery(driver.name, result, existingEventId);
}

/** Calls the event off. The row keeps no event id afterwards, whatever the driver managed. */
export async function removeFromCalendar(eventId: string): Promise<CalendarDelivery> {
  const driver = calendarDriver();
  return { ...delivery(driver.name, await driver.cancel(eventId), null), eventId: null, meetingUrl: null };
}
