// A person's selling over a period (FR-CRM-44), for the KPI job that proposes sales actuals: value
// won and deals won or lost by their owner, new accounts won (the account's first won deal), what
// was invoiced and collected on the accounts a person manages, and follow-ups done by their day.
// Every figure summed in SQL per person; nothing read row by row.
import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { dealValueSql } from "./accounts";

export type SalesFacts = { wonValueVnd: number; dealsWon: number; dealsLost: number; newAccounts: number; invoicedVnd: number; collectedVnd: number; followUpsDue: number; followUpsOnTime: number };
const EMPTY: SalesFacts = { wonValueVnd: 0, dealsWon: 0, dealsLost: 0, newAccounts: 0, invoicedVnd: 0, collectedVnd: 0, followUpsDue: 0, followUpsOnTime: 0 };

export async function salesFactsOf(personIds: readonly string[], range: { from: IsoDate; to: IsoDate }): Promise<Map<string, SalesFacts>> {
  const result = new Map(personIds.map((id) => [id, { ...EMPTY }]));
  if (personIds.length === 0) return result;
  const ids = [...personIds];
  const closedOn = (column: typeof schema.crmDeal.wonAt | typeof schema.crmDeal.lostAt) => sql`(${column} at time zone 'Asia/Ho_Chi_Minh')::date between ${range.from}::date and ${range.to}::date`;
  const [deals, invoiced, collected, followUps] = await Promise.all([
    db()
      .select({
        personId: schema.crmDeal.ownerPersonId,
        won: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'won' and ${closedOn(schema.crmDeal.wonAt)})`,
        wonValue: sql<number>`coalesce(sum(${dealValueSql}) filter (where ${schema.crmDeal.status} = 'won' and ${closedOn(schema.crmDeal.wonAt)}), 0)`,
        lost: sql<number>`count(*) filter (where ${schema.crmDeal.status} = 'lost' and ${closedOn(schema.crmDeal.lostAt)})`,
        newAccounts: sql<number>`count(distinct ${schema.crmDeal.clientId}) filter (where ${schema.crmDeal.status} = 'won' and ${closedOn(schema.crmDeal.wonAt)} and not exists (select 1 from ${schema.crmDeal} earlier where earlier.client_id = ${schema.crmDeal.clientId} and earlier.status = 'won' and earlier.won_at < ${schema.crmDeal.wonAt}))`,
      })
      .from(schema.crmDeal)
      .where(inArray(schema.crmDeal.ownerPersonId, ids))
      .groupBy(schema.crmDeal.ownerPersonId),
    db()
      .select({ personId: schema.workClient.accountManagerPersonId, amount: sql<number>`coalesce(sum(${schema.crmInvoice.subtotalVnd}), 0)` })
      .from(schema.crmInvoice)
      .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmInvoice.clientId))
      .where(and(inArray(schema.workClient.accountManagerPersonId, ids), sql`${schema.crmInvoice.issuedOn} between ${range.from}::date and ${range.to}::date`))
      .groupBy(schema.workClient.accountManagerPersonId),
    db()
      .select({ personId: schema.workClient.accountManagerPersonId, amount: sql<number>`coalesce(sum(${schema.crmPayment.amountVnd}), 0)` })
      .from(schema.crmPayment)
      .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmPayment.invoiceId))
      .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmInvoice.clientId))
      .where(and(inArray(schema.workClient.accountManagerPersonId, ids), sql`${schema.crmPayment.receivedOn} between ${range.from}::date and ${range.to}::date`))
      .groupBy(schema.workClient.accountManagerPersonId),
    db()
      .select({ personId: schema.crmActivity.ownerPersonId, due: sql<number>`count(*)`, onTime: sql<number>`count(*) filter (where ${schema.crmActivity.doneAt} is not null and (${schema.crmActivity.doneAt} at time zone 'Asia/Ho_Chi_Minh')::date <= ${schema.crmActivity.dueOn})` })
      .from(schema.crmActivity)
      .where(and(inArray(schema.crmActivity.ownerPersonId, ids), isNotNull(schema.crmActivity.dueOn), sql`${schema.crmActivity.dueOn} between ${range.from}::date and ${range.to}::date`))
      .groupBy(schema.crmActivity.ownerPersonId),
  ]);
  for (const row of deals) Object.assign(result.get(row.personId)!, { dealsWon: Number(row.won), wonValueVnd: Number(row.wonValue), dealsLost: Number(row.lost), newAccounts: Number(row.newAccounts) });
  for (const row of invoiced) if (row.personId) result.get(row.personId)!.invoicedVnd = Number(row.amount);
  for (const row of collected) if (row.personId) result.get(row.personId)!.collectedVnd = Number(row.amount);
  for (const row of followUps) Object.assign(result.get(row.personId)!, { followUpsDue: Number(row.due), followUpsOnTime: Number(row.onTime) });
  return result;
}
