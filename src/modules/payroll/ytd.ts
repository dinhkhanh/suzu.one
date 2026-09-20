// Year-to-date figures for people whose tax year started outside the system (FR-PAY-35).
//
// The annual finalization has to cover the whole year, but the system only knows the months it
// ran. These rows are the rest: one per person per year, imported from what the previous method
// filed, encrypted like any other figure about a person's pay, and added to the runs when the
// finalization is built.
//
// No authorization inside — the import and the export actions check `payroll:propose` over the
// entity before calling.
import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import { ytdFiguresContext } from "./field-contexts";

type Executor = Tx | ReturnType<typeof db>;

export type YtdRow = typeof schema.payrollYtd.$inferSelect;

/**
 * What the previous method already paid and withheld in the year, before the system took over.
 * The same shape the finalization adds up, so importing a year and running it produce one total.
 */
export type YtdFigures = {
  taxableIncome: number;
  insuranceDeduction: number;
  personalDeduction: number;
  dependentDeduction: number;
  otherDeductions: number;
  assessableIncome: number;
  taxWithheld: number;
};

export const EMPTY_YTD: YtdFigures = { taxableIncome: 0, insuranceDeduction: 0, personalDeduction: 0, dependentDeduction: 0, otherDeductions: 0, assessableIncome: 0, taxWithheld: 0 };

export const openYtd = (row: YtdRow): YtdFigures => JSON.parse(fieldCipher().decrypt(row.figuresEnc, ytdFiguresContext(row.id))) as YtdFigures;

export async function listYtd(entityId: string, year: number, executor: Executor = db()): Promise<{ row: YtdRow; figures: YtdFigures }[]> {
  const rows = await executor.select().from(schema.payrollYtd).where(and(eq(schema.payrollYtd.entityId, entityId), eq(schema.payrollYtd.year, year)));
  return rows.map((row) => ({ row, figures: openYtd(row) }));
}

export async function listYtdForPeople(personIds: readonly string[], year: number, executor: Executor = db()): Promise<Map<string, { row: YtdRow; figures: YtdFigures }>> {
  if (personIds.length === 0) return new Map();
  const rows = await executor.select().from(schema.payrollYtd).where(and(inArray(schema.payrollYtd.personId, [...personIds]), eq(schema.payrollYtd.year, year)));
  return new Map(rows.map((row) => [row.personId, { row, figures: openYtd(row) }]));
}

export type YtdInput = { personId: string; entityId: string; year: number; months: number; figures: YtdFigures; note: string | null };

/**
 * Writes one person's year. Idempotent by (person, year): importing the same file twice leaves the
 * same single row, which is what makes a corrected re-import safe.
 */
export async function saveYtd(tx: Tx, input: YtdInput, actorPersonId: string | null): Promise<YtdRow> {
  const id = crypto.randomUUID();
  const figuresEnc = fieldCipher().encrypt(JSON.stringify(input.figures), ytdFiguresContext(id));
  const [existing] = await tx.select({ id: schema.payrollYtd.id }).from(schema.payrollYtd).where(and(eq(schema.payrollYtd.personId, input.personId), eq(schema.payrollYtd.year, input.year))).limit(1);

  if (existing) {
    // The ciphertext is bound to the row it lives in, so a replacement is re-encrypted for that row.
    const [updated] = await tx
      .update(schema.payrollYtd)
      .set({ entityId: input.entityId, months: input.months, figuresEnc: fieldCipher().encrypt(JSON.stringify(input.figures), ytdFiguresContext(existing.id)), note: input.note, createdByPersonId: actorPersonId, updatedAt: new Date() })
      .where(eq(schema.payrollYtd.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await tx
    .insert(schema.payrollYtd)
    .values({ id, entityId: input.entityId, personId: input.personId, year: input.year, months: input.months, figuresEnc, note: input.note, createdByPersonId: actorPersonId })
    .returning();
  return created;
}
