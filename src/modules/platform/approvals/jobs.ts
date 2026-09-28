// The oversight digest: each morning, whoever follows every request (`approval:oversee`, the
// owner) hears what was filed the day before and how much of it is still open — one notification,
// not one per request, and nothing on a day when nobody filed anything. The figures only: the
// link opens the "All requests" list from that day, where each row is behind its own page.
import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import type { JobDefinition } from "../jobs/service";
import { notify } from "../notifications/service";
import { listPeopleHolding } from "../rbac/service";
import { requestsFiledBetween } from "./service";

const KIND = "approvals.oversight_digest";

export async function sendOversightDigest(today: IsoDate): Promise<{ filed: number; told: number }> {
  const day = addDays(today, -1);
  const { filed, open } = await requestsFiledBetween(new Date(`${day}T00:00:00+07:00`), new Date(`${addDays(day, 1)}T00:00:00+07:00`));
  if (filed === 0) return { filed, told: 0 };

  // A group-wide grant only: the figures are the whole company's. `includeWildcard` because the
  // permission is held through "*" and nothing else.
  const overseers = await listPeopleHolding("approval:oversee", {});
  if (overseers.length === 0) return { filed, told: 0 };
  // Run twice in a morning, it tells nobody twice.
  const told = await db()
    .select({ personId: schema.notification.recipientPersonId })
    .from(schema.notification)
    .where(and(eq(schema.notification.kind, KIND), inArray(schema.notification.recipientPersonId, overseers), sql`${schema.notification.params}->>'date' = ${day}`));
  const fresh = overseers.filter((personId) => !told.some((row) => row.personId === personId));
  if (fresh.length > 0) await notify({ recipients: fresh, kind: KIND, params: { date: day, count: filed, open }, link: `/approvals/all?since=${day}` });
  return { filed, told: fresh.length };
}

export const approvalsOversightDigestJob: JobDefinition = {
  name: "approvals-oversight-digest",
  run: async ({ today }) => sendOversightDigest(today),
};
