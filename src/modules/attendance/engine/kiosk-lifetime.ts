// How long a tablet opened as a kiosk stays one (NFR-SEC-01). Pure.
//
// The tablet's cookie is a capability: whoever holds it can name faces and punch for them, and a
// server cannot tell a living face from 128 numbers sent again. So the capability ends by itself,
// on the server, whatever the cookie says:
//
//   · **Rolling.** A kiosk in use stays open: every call it makes counts as being seen. Left
//     unused for `KIOSK_IDLE_DAYS` — a tablet taken off the wall, a cookie copied and kept for
//     later — it stops.
//   · **A hard maximum.** `KIOSK_MAX_DAYS` after it was opened it stops however busy it is, and HR
//     opens it again on the tablet: once a quarter somebody with the permission stands in front
//     of the thing and says it is still theirs.
//
// Both are read off the two moments a session already carries, so there is no third date to keep
// in step with them, and changing a number here changes every open kiosk at once.

/** A kiosk nobody has used for this many days is no longer a kiosk. */
export const KIOSK_IDLE_DAYS = 14;
/** However much it is used, a kiosk is opened again by HR after this many days. */
export const KIOSK_MAX_DAYS = 90;

const DAY_MS = 86_400_000;

export type KioskTimes = { openedAt: Date; lastSeenAt: Date | null };

/** The last moment the kiosk was used; one that never called in was last used when it was opened. */
const lastUsedAt = (session: KioskTimes): Date => (session.lastSeenAt && session.lastSeenAt > session.openedAt ? session.lastSeenAt : session.openedAt);

/** When the kiosk stops if it is not used again: the earlier of the idle limit and the hard maximum. */
export function kioskExpiresAt(session: KioskTimes): Date {
  return new Date(Math.min(lastUsedAt(session).getTime() + KIOSK_IDLE_DAYS * DAY_MS, session.openedAt.getTime() + KIOSK_MAX_DAYS * DAY_MS));
}

/** Why the kiosk has stopped at `now` — unused too long, or open too long — or null while it runs. */
export function kioskLapse(session: KioskTimes, now: Date): "idle" | "max" | null {
  if (now.getTime() >= session.openedAt.getTime() + KIOSK_MAX_DAYS * DAY_MS) return "max";
  if (now.getTime() >= lastUsedAt(session).getTime() + KIOSK_IDLE_DAYS * DAY_MS) return "idle";
  return null;
}
