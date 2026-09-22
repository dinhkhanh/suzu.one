// What each person's day is (a working day, a holiday, leave, an untracked Saturday), how long it
// is, and what the daily loop asks of them on it. Reads attendance's day plans and leave's approved
// days — the legal record — and never writes to either.
import "server-only";
import { type IsoDate } from "@/lib/dates";
import { getDayPlans } from "@/modules/attendance/service";
import { getLeaveOnDays } from "@/modules/leave/service";
import { type DayFacts, type DayKind, isDayOff, planRequirement, type PersonRules, reportRequirement, type Requirement } from "./engine/rules";
import { DEFAULT_DAY_MINUTES } from "./enums";
import { rulesOfPeople } from "./team-rules";

export type PersonDay = {
  day: DayFacts;
  rules: PersonRules;
  teamIds: string[];
  report: Requirement;
  plan: Requirement;
  dayOff: boolean;
  /** The person's hours that day, less any leave: what the morning plan's estimates are set against. */
  minutes: number;
};

/** Every person's days between two dates (inclusive), in a fixed number of queries. */
export async function daysOf(personIds: readonly string[], from: IsoDate, to: IsoDate): Promise<Map<string, Map<IsoDate, PersonDay>>> {
  const ids = [...new Set(personIds)];
  const result = new Map<string, Map<IsoDate, PersonDay>>();
  if (ids.length === 0 || to < from) return result;
  const [plans, leave, teams] = await Promise.all([getDayPlans(ids, from, to), getLeaveOnDays(ids, from, to), rulesOfPeople(ids)]);
  const leaveOn = new Map<string, { full: boolean; share: number }>();
  for (const row of leave) {
    const key = `${row.personId}:${row.date}`;
    const seen = leaveOn.get(key) ?? { full: false, share: 0 };
    seen.full ||= row.portion === "full" || row.amountCenti >= 100;
    seen.share = Math.min(100, seen.share + row.amountCenti);
    leaveOn.set(key, seen);
  }
  for (const personId of ids) {
    const own = teams.get(personId)!;
    const days = new Map<IsoDate, PersonDay>();
    for (const plan of plans.get(personId)?.days ?? []) {
      const away = leaveOn.get(`${personId}:${plan.date}`);
      const day: DayFacts = { date: plan.date, kind: plan.kind as DayKind, name: plan.name, leave: away ? (away.full ? "full" : "part") : null };
      const scheduled = plan.requiredMinutes > 0 ? plan.requiredMinutes : DEFAULT_DAY_MINUTES;
      const minutes = away?.full ? 0 : Math.round((scheduled * (100 - (away?.share ?? 0))) / 100);
      days.set(plan.date, { day, rules: own.rules, teamIds: own.teamIds, report: reportRequirement(own.rules, day), plan: planRequirement(own.rules, day), dayOff: isDayOff(own.rules, day), minutes });
    }
    result.set(personId, days);
  }
  return result;
}

/** `daysOf` for one date. */
export async function dayOf(personIds: readonly string[], date: IsoDate): Promise<Map<string, PersonDay>> {
  const days = await daysOf(personIds, date, date);
  return new Map([...days].flatMap(([personId, own]) => (own.has(date) ? [[personId, own.get(date)!] as const] : [])));
}
