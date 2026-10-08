// The CRM's share of a person's day for the end-of-day report (FR-CRM-43), through the platform's
// day-activity registry: the activities they logged or completed, and the deals they moved to
// another stage. Names of accounts, deals and subjects only — never a value, never a contact's details.
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import type { DayActivity } from "../platform/day-activity/registry";
import { listDoneBy } from "./activities";

export async function crmDay(executor: unknown, personId: string, date: string): Promise<DayActivity[]> {
  const from = executor as Tx | ReturnType<typeof db>;
  const [activities, moves] = await Promise.all([
    listDoneBy([personId], date, from),
    from
      .select({ title: schema.crmDeal.title, account: schema.workClient.name, stage: schema.crmStage.name, at: schema.crmDealStageChange.changedAt })
      .from(schema.crmDealStageChange)
      .innerJoin(schema.crmDeal, eq(schema.crmDeal.id, schema.crmDealStageChange.dealId))
      .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmDeal.clientId))
      .innerJoin(schema.crmStage, eq(schema.crmStage.id, schema.crmDealStageChange.toStageId))
      .where(and(eq(schema.crmDealStageChange.changedByPersonId, personId), sql`(${schema.crmDealStageChange.changedAt} at time zone 'Asia/Ho_Chi_Minh')::date = ${date}::date`)),
  ]);
  return [
    ...activities.map((activity) => ({
      kind: "client_activity",
      title: [activity.accountName ?? activity.leadCompany, activity.subject].filter(Boolean).join(": "),
      detail: activity.outcome,
      at: (activity.occurredAt ?? activity.doneAt ?? activity.createdAt).toISOString(),
    })),
    ...moves.map((move) => ({ kind: "deal_moved", title: `${move.account}: ${move.title}`, detail: move.stage, at: move.at.toISOString() })),
  ];
}
