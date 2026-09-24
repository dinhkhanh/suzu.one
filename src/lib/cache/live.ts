import "server-only";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { cached, invalidate, TTL } from "./index";

// The "live" tier (see index.ts): what a person's screens show and many hands change — the
// badges in the app frame, the Today page, My work, the approvals inbox, the notification list.
// One entry per person and screen, the shortest TTL, and two invalidation rules that cover
// nearly every change without each writer knowing about every screen:
//   1. `createAction()` drops the actor's entries after every action — what I just did is on my
//      screens at once (a task finished, a request answered, a notification read).
//   2. `notify()` drops the recipients' entries — what somebody else did that concerns me reaches
//      my screens with the notification about it (a task assigned, a review asked, a hand-off).
// A change that neither rule reaches (a cron job, a teammate's silent state change) shows within
// `TTL.live` seconds.

export const LIVE_SCREENS = ["shell", "today", "tasks", "approvals", "notifications"] as const;
export type LiveScreen = (typeof LIVE_SCREENS)[number];

/** Today's page is a different entry each day, so yesterday's never answers for today. */
export function liveKey(personId: string, screen: LiveScreen, date: IsoDate = todayInVietnam()): string {
  return screen === "today" ? `live:${personId}:today:${date}` : `live:${personId}:${screen}`;
}

/** `cached()` for one person's screen, under the live tier's TTL. */
export function cachedLive<T>(personId: string, screen: LiveScreen, load: () => Promise<T>): Promise<T> {
  return cached(liveKey(personId, screen), TTL.live, load);
}

/** Every live entry of these people. Call after anything their screens show has changed. */
export function invalidateLive(...personIds: readonly string[]): Promise<void> {
  const ids = [...new Set(personIds)];
  return invalidate(...ids.flatMap((id) => LIVE_SCREENS.map((screen) => liveKey(id, screen))));
}
