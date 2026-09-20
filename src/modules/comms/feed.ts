// The home feed (FR-COM-02): what waits for me, announcements, new joiners, birthdays, work
// anniversaries, kudos, new knowledge-base pages. Open jobs arrive with recruitment (Phase 7).
//
// Sensitivity: people items are directory-tier facts, shown to staff only — a collaborator has no
// directory and gets none of them. A birthday is a day and a month: core-hr selects nothing else,
// so no year and no age exist anywhere in what this returns.
import "server-only";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { listStaffOccasionFacts } from "../core-hr/service";
import { type KbPageCard, kbViewerOf, listMyPendingAcks, listRecentlyPublished, type PendingAck } from "../kb/service";
import { countInbox } from "../platform/approvals/service";
import type { Principal } from "../platform/rbac/policy";
import { type AnnouncementCard, commsViewerOf, listAnnouncementsFor } from "./announcements";
import { recentJoiners, upcomingAnniversaries, upcomingBirthdays } from "./engine/occasions";
import { type KudosCard, listKudos } from "./kudos";

export const FEED_WINDOW_DAYS = 7;
export const FEED_JOINER_DAYS = 14;

type FeedPerson = { personId: string; fullName: string; departmentName: string | null; entityName: string | null };
export type HomeFeed = {
  today: IsoDate;
  pending: { acks: PendingAck[]; announcements: AnnouncementCard[]; approvals: number };
  announcements: AnnouncementCard[];
  joiners: (FeedPerson & { positionName: string | null; startDate: IsoDate })[];
  birthdays: (FeedPerson & { month: number; day: number; inDays: number })[];
  anniversaries: (FeedPerson & { month: number; day: number; inDays: number; years: number })[];
  kudos: KudosCard[];
  newPages: KbPageCard[];
};

type FeedUser = { person: { id: string; primaryEntityId: string | null; departmentId: string | null; teamId: string | null }; principal: Principal };

export async function getHomeFeed(user: FeedUser, today: IsoDate = todayInVietnam()): Promise<HomeFeed> {
  const viewer = await commsViewerOf(user, today);
  const kbViewer = kbViewerOf(user);
  const staff = user.principal.workforceType !== "collaborator";

  const [acks, mustAck, approvals, announcements, newPages, facts, kudos] = await Promise.all([
    listMyPendingAcks(kbViewer, today),
    listAnnouncementsFor(viewer, { onlyPendingAck: true, limit: 10 }),
    countInbox(user.person.id),
    listAnnouncementsFor(viewer, { limit: 6 }),
    listRecentlyPublished(kbViewer, { firstVersionsOnly: true, since: new Date(Date.now() - 30 * 86_400_000), limit: 6 }),
    staff ? listStaffOccasionFacts(today) : Promise.resolve([]),
    staff ? listKudos({ limit: 6 }) : Promise.resolve([]),
  ]);

  const byId = new Map(facts.map((fact) => [fact.personId, fact]));
  const who = (personId: string): FeedPerson => {
    const fact = byId.get(personId)!;
    return { personId, fullName: fact.fullName, departmentName: fact.departmentName, entityName: fact.entityName };
  };

  return {
    today,
    pending: { acks, announcements: mustAck, approvals },
    announcements,
    joiners: recentJoiners(facts, today, FEED_JOINER_DAYS).map((fact) => ({ ...who(fact.personId), positionName: fact.positionName, startDate: fact.startDate })),
    birthdays: upcomingBirthdays(facts, today, FEED_WINDOW_DAYS).map((row) => ({ ...who(row.personId), month: row.month, day: row.day, inDays: row.inDays })),
    anniversaries: upcomingAnniversaries(facts, today, FEED_WINDOW_DAYS).map((row) => ({ ...who(row.personId), month: row.month, day: row.day, inDays: row.inDays, years: row.years })),
    kudos,
    newPages,
  };
}
