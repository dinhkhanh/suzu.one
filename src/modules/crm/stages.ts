// Pipeline stages (FR-CRM-12) and the CRM's settings. Stages are reference data read by every
// pipeline screen: the whole table sits in the shared cache under one key, ordered, and each writer
// below drops it once committed. The settings are effective-dated company practice in the
// parameter store (owner-approved), read through its own cache.
import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getParameter } from "../platform/statutory/service";
import type { StageCategory, StageGate } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type StageRow = typeof schema.crmStage.$inferSelect;

const STAGES_KEY = "crm:stages";

/** Every stage, active or not, in board order (then by id, so the cached array is always the same). */
export async function listStages(executor?: Executor): Promise<StageRow[]> {
  const read = (from: Executor) => from.select().from(schema.crmStage).orderBy(asc(schema.crmStage.sortOrder), asc(schema.crmStage.id));
  return executor && executor !== db() ? read(executor) : cached(STAGES_KEY, TTL.reference, () => read(db()));
}

export const invalidateStages = () => invalidate(STAGES_KEY);

/** The stage's name in the reader's language: English where one is given, else the Vietnamese. */
export const stageName = (stage: Pick<StageRow, "name" | "nameEn">, locale: string): string => (locale === "en" && stage.nameEn ? stage.nameEn : stage.name);

/** The first active stage of a category in board order: where a new deal starts, where "won" and "lost" go. */
export function firstStageOf(stages: readonly StageRow[], category: StageCategory): StageRow | undefined {
  return stages.find((stage) => stage.isActive && stage.category === category);
}

export type StageInput = { name: string; nameEn: string | null; category: StageCategory; probability: number; gates: StageGate[]; allowsPitch: boolean; sortOrder: number; isActive: boolean };

export async function saveStage(stageId: string | null, input: StageInput): Promise<{ before: StageRow | null; after: StageRow }> {
  const probability = input.category === "won" ? 100 : input.category === "lost" ? 0 : Math.min(99, Math.max(0, input.probability));
  const values = { ...input, probability, gates: [...new Set(input.gates)] };
  const saved = await db().transaction(async (tx) => {
    if (!stageId) {
      const [after] = await tx.insert(schema.crmStage).values(values).returning();
      return { before: null, after };
    }
    const [before] = await tx.select().from(schema.crmStage).where(eq(schema.crmStage.id, stageId)).limit(1);
    if (!before) throw new ActionError("stage_not_found");
    // A stage deals sit in keeps its category: moving "Negotiation" into "won" would win them all silently.
    if (before.category !== input.category) {
      const [used] = await tx.select({ n: sql<number>`count(*)` }).from(schema.crmDeal).where(eq(schema.crmDeal.stageId, stageId));
      if (Number(used?.n ?? 0) > 0) throw new ActionError("stage_in_use");
    }
    const [after] = await tx.update(schema.crmStage).set({ ...values, updatedAt: new Date() }).where(eq(schema.crmStage.id, stageId)).returning();
    return { before, after };
  });
  await invalidateStages();
  return saved;
}

export type CrmSettings = { staleDealDays: number; renewalLeadDays: number; receivableReminderDays: number[]; defaultPaymentTermsDays: number; quoteValidityDays: number; quoteDiscountApprovalBp: number; quoteMarginFloorBp: number };

/** The settings in force on a day (the parameter store's cache). */
export const crmSettings = (date: IsoDate = todayInVietnam(), executor?: Executor): Promise<CrmSettings> => getParameter("crm.settings", date, executor);

/** VAT in force on a day: the default rate and the rates allowed. */
export const vatRates = (date: IsoDate = todayInVietnam(), executor?: Executor): Promise<{ defaultBp: number; allowedBp: number[] }> => getParameter("tax.vat", date, executor);
