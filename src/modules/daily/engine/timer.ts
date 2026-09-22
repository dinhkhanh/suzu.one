// A running timer becomes a time entry (FR-PJM-24). Pure: the service passes the instant the timer
// started and the instant it stopped, both from the server's clock.
//
// The entry belongs to the day the timer started, in Vietnam: work started at 22:00 and stopped
// after midnight is that evening's work, not the next day's. A timer nobody stopped is not a
// sixteen-hour day of work: it is cut at 16 hours and flagged, so the person corrects it.

type IsoDate = string;

/** The longest stretch one timer can record. */
export const TIMER_CAP_MINUTES = 16 * 60;

export type StoppedTimer = {
  /** The day the entry belongs to: the start date, Vietnam time. */
  date: IsoDate;
  /** Whole minutes, rounded to the nearest; 0 when the timer ran under half a minute. */
  minutes: number;
  /** The timer ran past the cap and was cut there. */
  capped: boolean;
};

/** A date in Vietnam (UTC+7, no daylight saving) for an instant. */
export const vietnamDateOf = (instant: Date): IsoDate => new Date(instant.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

export function stopTimer(startedAt: Date, stoppedAt: Date): StoppedTimer {
  const elapsed = Math.max(0, stoppedAt.getTime() - startedAt.getTime());
  const minutes = Math.round(elapsed / 60_000);
  return { date: vietnamDateOf(startedAt), minutes: Math.min(minutes, TIMER_CAP_MINUTES), capped: minutes > TIMER_CAP_MINUTES };
}
