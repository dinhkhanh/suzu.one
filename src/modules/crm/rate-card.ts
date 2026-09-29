// The rate card (FR-CRM-20): services with their unit, the register line a sold unit becomes, the
// hours by role one unit takes, and effective-dated list prices — the group's, or an entity's own
// that replaces it. Reference data: services and prices sit in the shared cache under one key, and
// every writer below drops it once committed.
import "server-only";
import { asc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import type { RoleMinutes } from "./schema";

type Executor = Tx | ReturnType<typeof db>;
export type ServiceRow = typeof schema.crmService.$inferSelect;
export type ServicePriceRow = typeof schema.crmServicePrice.$inferSelect;
export type RateCard = { services: ServiceRow[]; prices: ServicePriceRow[] };

const RATE_CARD_KEY = "crm:rate-card";

async function readRateCard(from: Executor): Promise<RateCard> {
  const [services, prices] = await Promise.all([
    from.select().from(schema.crmService).orderBy(asc(schema.crmService.category), asc(schema.crmService.code)),
    from.select().from(schema.crmServicePrice).orderBy(asc(schema.crmServicePrice.serviceId), asc(schema.crmServicePrice.validFrom), asc(schema.crmServicePrice.id)),
  ]);
  return { services, prices };
}

export async function getRateCard(executor?: Executor): Promise<RateCard> {
  return executor && executor !== db() ? readRateCard(executor) : cached(RATE_CARD_KEY, TTL.reference, () => readRateCard(db()));
}

export const invalidateRateCard = () => invalidate(RATE_CARD_KEY);

/**
 * The list price of a service on a day for an entity: the entity's own price in force if it has
 * one, else the group's. null = no price in force (the quote line is priced by hand).
 */
export function priceOn(card: RateCard, serviceId: string, entityId: string | null, date: IsoDate): number | null {
  const inForce = (scope: string | null) =>
    card.prices
      .filter((price) => price.serviceId === serviceId && price.entityId === scope && price.validFrom <= date)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom))
      .at(-1);
  return (entityId ? inForce(entityId) : undefined)?.priceVnd ?? inForce(null)?.priceVnd ?? null;
}

export type ServiceInput = { code: string; name: string; nameEn: string | null; category: string; unit: string; isRecurring: boolean; format: string | null; channel: string | null; roleMinutes: RoleMinutes[]; description: string | null; isActive: boolean };

export async function saveService(serviceId: string | null, input: ServiceInput): Promise<{ before: ServiceRow | null; after: ServiceRow }> {
  const values = { ...input, roleMinutes: input.roleMinutes.filter((entry) => entry.role.trim() && entry.minutes > 0) };
  const saved = await db().transaction(async (tx) => {
    const [taken] = await tx.select({ id: schema.crmService.id }).from(schema.crmService).where(eq(schema.crmService.code, input.code)).limit(1);
    if (taken && taken.id !== serviceId) throw new ActionError("service_code_taken");
    if (!serviceId) {
      const [after] = await tx.insert(schema.crmService).values(values).returning();
      return { before: null, after };
    }
    const [before] = await tx.select().from(schema.crmService).where(eq(schema.crmService.id, serviceId)).limit(1);
    if (!before) throw new ActionError("service_not_found");
    const [after] = await tx.update(schema.crmService).set({ ...values, updatedAt: new Date() }).where(eq(schema.crmService.id, serviceId)).returning();
    return { before, after };
  });
  await invalidateRateCard();
  return saved;
}

/** A new price from a date. A price already starting that day for the same scope is replaced — a correction. */
export async function setPrice(serviceId: string, input: { entityId: string | null; priceVnd: number; validFrom: IsoDate }, actorPersonId: string): Promise<ServicePriceRow> {
  const saved = await db().transaction(async (tx) => {
    const [service] = await tx.select({ id: schema.crmService.id }).from(schema.crmService).where(eq(schema.crmService.id, serviceId)).limit(1);
    if (!service) throw new ActionError("service_not_found");
    const existing = (await tx.select().from(schema.crmServicePrice).where(eq(schema.crmServicePrice.serviceId, serviceId))).find((row) => row.entityId === input.entityId && row.validFrom === input.validFrom);
    if (existing) {
      const [row] = await tx.update(schema.crmServicePrice).set({ priceVnd: input.priceVnd, createdByPersonId: actorPersonId }).where(eq(schema.crmServicePrice.id, existing.id)).returning();
      return row;
    }
    const [row] = await tx.insert(schema.crmServicePrice).values({ serviceId, ...input, createdByPersonId: actorPersonId }).returning();
    return row;
  });
  await invalidateRateCard();
  return saved;
}

export type ServiceView = ServiceRow & { priceNow: number | null; entityPrices: { entityId: string; priceVnd: number }[]; upcoming: ServicePriceRow[] };

/** The card as the page shows it: each service with its group price today, entity prices today, and prices still to come. */
export async function rateCardView(today: IsoDate = todayInVietnam()): Promise<ServiceView[]> {
  const card = await getRateCard();
  return card.services.map((service) => {
    const own = card.prices.filter((price) => price.serviceId === service.id);
    const entityIds = [...new Set(own.flatMap((price) => (price.entityId ? [price.entityId] : [])))];
    return {
      ...service,
      priceNow: priceOn({ services: [], prices: own.filter((price) => price.entityId === null) }, service.id, null, today),
      entityPrices: entityIds.flatMap((entityId) => {
        const price = own.filter((row) => row.entityId === entityId && row.validFrom <= today).at(-1);
        return price ? [{ entityId, priceVnd: price.priceVnd }] : [];
      }),
      upcoming: own.filter((price) => price.validFrom > today),
    };
  });
}
