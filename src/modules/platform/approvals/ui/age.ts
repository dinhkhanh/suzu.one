// How long a request has been waiting, as the inbox shows it: hours for the first day, days after
// that, and a flag once it has sat for more than two days. Pure, so the server rows and the
// client inbox agree.
export type Age = { hours: number; days: number; /** Over two days: the inbox colours it. */ stale: boolean };

export function ageOf(createdAt: Date, now: Date = new Date()): Age {
  const hours = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000));
  const days = Math.floor(hours / 24);
  return { hours, days, stale: days > 2 };
}
