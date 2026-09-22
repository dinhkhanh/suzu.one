// Parallel run (FR-PAY-38): the system's payroll held against what the existing method paid, one
// person at a time, until nothing differs that nobody can explain.
//
// Go-live needs "a parallel cycle with zero unexplained differences" (development plan §3, Phase 5),
// so that is exactly what this produces: a per-person report where every differing figure is
// either explained — as a system bug, a spreadsheet error, a rule gap or accepted rounding — or
// counted as unexplained. An explanation is bound to **the difference it was given for**: if the
// run is recalculated and the gap changes, the old explanation no longer covers it and the line
// goes back to unexplained. Nobody can sign off a reconciliation that has quietly moved.
//
// No authorization inside — `parallel-actions.ts` checks `payroll:propose` over the entity first.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema, type Tx } from "@/lib/db";
import { listPayrollNames } from "@/modules/core-hr/service";
import { parallelDeltaContext, parallelReferenceContext } from "./field-contexts";
import { openResult } from "./run-storage";

type Executor = Tx | ReturnType<typeof db>;

export type ReferenceRow = typeof schema.payrollParallelReference.$inferSelect;
export type FindingRow = typeof schema.payrollParallelFinding.$inferSelect;
export type FindingClass = FindingRow["classification"];

/**
 * What the existing method says a person was paid. The same six figures a payroll spreadsheet
 * carries — a deeper comparison per pay component would need the spreadsheet to name its
 * components, which no two of them do the same way.
 */
export type ReferenceFigures = {
  gross: number;
  employeeInsurance: number;
  unionDues: number;
  pit: number;
  otherDeductions: number;
  net: number;
};

/** The fields compared, in the order the report shows them. */
export const COMPARED_FIELDS = ["gross", "employeeInsurance", "unionDues", "pit", "otherDeductions", "net"] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export const EMPTY_REFERENCE: ReferenceFigures = { gross: 0, employeeInsurance: 0, unionDues: 0, pit: 0, otherDeductions: 0, net: 0 };

export const openReference = (row: ReferenceRow): ReferenceFigures => JSON.parse(fieldCipher().decrypt(row.figuresEnc, parallelReferenceContext(row.id))) as ReferenceFigures;
export const openDelta = (row: FindingRow): number => Number(fieldCipher().decrypt(row.deltaEnc, parallelDeltaContext(row.id)));

// ── Recording what the other method said ────────────────────────────────────────────────────

export type ReferenceInput = { entityId: string; month: string; personId: string; figures: ReferenceFigures; note: string | null };

/** Idempotent per (entity, month, person): typing or importing the same person again replaces them. */
export async function saveReference(tx: Tx, input: ReferenceInput, actorPersonId: string | null): Promise<ReferenceRow> {
  const [existing] = await tx
    .select({ id: schema.payrollParallelReference.id })
    .from(schema.payrollParallelReference)
    .where(and(eq(schema.payrollParallelReference.entityId, input.entityId), eq(schema.payrollParallelReference.month, input.month), eq(schema.payrollParallelReference.personId, input.personId)))
    .limit(1);

  if (existing) {
    const [updated] = await tx
      .update(schema.payrollParallelReference)
      .set({ figuresEnc: fieldCipher().encrypt(JSON.stringify(input.figures), parallelReferenceContext(existing.id)), note: input.note, createdByPersonId: actorPersonId, updatedAt: new Date() })
      .where(eq(schema.payrollParallelReference.id, existing.id))
      .returning();
    return updated;
  }

  const id = randomUUID();
  const [created] = await tx
    .insert(schema.payrollParallelReference)
    .values({ id, entityId: input.entityId, personId: input.personId, month: input.month, figuresEnc: fieldCipher().encrypt(JSON.stringify(input.figures), parallelReferenceContext(id)), note: input.note, createdByPersonId: actorPersonId })
    .returning();
  return created;
}

export async function removeReference(entityId: string, month: string, personId: string, executor: Executor = db()): Promise<void> {
  await executor
    .delete(schema.payrollParallelReference)
    .where(and(eq(schema.payrollParallelReference.entityId, entityId), eq(schema.payrollParallelReference.month, month), eq(schema.payrollParallelReference.personId, personId)));
}

// ── Explaining a difference ─────────────────────────────────────────────────────────────────

export type FindingInput = { entityId: string; month: string; personId: string; field: ComparedField; delta: number; classification: FindingClass; note: string };

export async function saveFinding(tx: Tx, input: FindingInput, actorPersonId: string | null): Promise<FindingRow> {
  const where = and(
    eq(schema.payrollParallelFinding.entityId, input.entityId),
    eq(schema.payrollParallelFinding.month, input.month),
    eq(schema.payrollParallelFinding.personId, input.personId),
    eq(schema.payrollParallelFinding.field, input.field),
  );
  const [existing] = await tx.select({ id: schema.payrollParallelFinding.id }).from(schema.payrollParallelFinding).where(where).limit(1);

  if (existing) {
    const [updated] = await tx
      .update(schema.payrollParallelFinding)
      .set({ deltaEnc: fieldCipher().encrypt(String(input.delta), parallelDeltaContext(existing.id)), classification: input.classification, note: input.note, classifiedByPersonId: actorPersonId, updatedAt: new Date() })
      .where(eq(schema.payrollParallelFinding.id, existing.id))
      .returning();
    return updated;
  }

  const id = randomUUID();
  const [created] = await tx
    .insert(schema.payrollParallelFinding)
    .values({
      id,
      entityId: input.entityId,
      personId: input.personId,
      month: input.month,
      field: input.field,
      deltaEnc: fieldCipher().encrypt(String(input.delta), parallelDeltaContext(id)),
      classification: input.classification,
      note: input.note,
      classifiedByPersonId: actorPersonId,
    })
    .returning();
  return created;
}

// ── The reconciliation itself ───────────────────────────────────────────────────────────────

export type DifferenceLine = {
  field: ComparedField;
  system: number;
  reference: number;
  /** system − reference. Positive: the system pays more. */
  delta: number;
  /** Set when somebody explained a difference **of exactly this size**. */
  classification: FindingClass | null;
  note: string | null;
  /**
   * There is an explanation on file, but it was given for a different figure — the run has been
   * recalculated or the reference re-imported since. It no longer counts as explained.
   */
  stale: boolean;
};

export type ReconciliationRow = {
  personId: string;
  fullName: string;
  employeeCode: string | null;
  /** Missing on one side: somebody the other method paid and this one did not, or the reverse. */
  presence: "both" | "system_only" | "reference_only";
  differences: DifferenceLine[];
  unexplained: number;
  matches: boolean;
};

export type Reconciliation = {
  entityId: string;
  month: string;
  /** Nobody has typed or imported the other method's figures yet. */
  hasReference: boolean;
  rows: ReconciliationRow[];
  summary: {
    people: number;
    matching: number;
    differing: number;
    unexplainedLines: number;
    missingFromSystem: number;
    missingFromReference: number;
    /** The one number go-live turns on (development plan §3, Phase 5). */
    zeroUnexplained: boolean;
  };
};

const systemFigures = (result: ReturnType<typeof openResult>): ReferenceFigures => ({
  gross: result.totals.grossEarnings,
  employeeInsurance: result.totals.employeeInsurance,
  unionDues: result.totals.unionDues,
  pit: result.totals.pit,
  otherDeductions: result.totals.otherDeductions,
  net: result.totals.net,
});

const addFigures = (left: ReferenceFigures, right: ReferenceFigures): ReferenceFigures => ({
  gross: left.gross + right.gross,
  employeeInsurance: left.employeeInsurance + right.employeeInsurance,
  unionDues: left.unionDues + right.unionDues,
  pit: left.pit + right.pit,
  otherDeductions: left.otherDeductions + right.otherDeductions,
  net: left.net + right.net,
});

/**
 * The month, person by person. Every run of the month counts — a bonus paid off-cycle is part of
 * what the person was paid, and the spreadsheet it is compared against will have it too.
 */
export async function reconcile(entityId: string, month: string, executor: Executor = db()): Promise<Reconciliation> {
  // The month's calculated people (through their runs), the reference figures and the findings, together.
  const [people, references, findings] = await Promise.all([
    executor
      .select({ row: schema.payrollRunPerson })
      .from(schema.payrollRunPerson)
      .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollRunPerson.runId))
      .where(and(eq(schema.payrollRun.entityId, entityId), eq(schema.payrollRun.month, month), ne(schema.payrollRun.status, "cancelled"), ne(schema.payrollRun.status, "draft")))
      .then((rows) => rows.map(({ row }) => row)),
    executor.select().from(schema.payrollParallelReference).where(and(eq(schema.payrollParallelReference.entityId, entityId), eq(schema.payrollParallelReference.month, month))),
    executor.select().from(schema.payrollParallelFinding).where(and(eq(schema.payrollParallelFinding.entityId, entityId), eq(schema.payrollParallelFinding.month, month))),
  ]);

  const systemByPerson = new Map<string, ReferenceFigures>();
  for (const row of people) systemByPerson.set(row.personId, addFigures(systemByPerson.get(row.personId) ?? EMPTY_REFERENCE, systemFigures(openResult(row))));
  const referenceByPerson = new Map(references.map((row) => [row.personId, openReference(row)]));

  const personIds = [...new Set([...systemByPerson.keys(), ...referenceByPerson.keys()])];
  // Only names are shown, so nothing about the people is decrypted.
  const factOf = new Map((await listPayrollNames(personIds, executor)).map((fact) => [fact.personId, fact]));
  const findingOf = new Map(findings.map((row) => [`${row.personId}:${row.field}`, row]));

  const rows = personIds.map((personId): ReconciliationRow => {
    const system = systemByPerson.get(personId);
    const reference = referenceByPerson.get(personId);
    const fact = factOf.get(personId);
    const differences: DifferenceLine[] = [];

    for (const field of COMPARED_FIELDS) {
      const left = system?.[field] ?? 0;
      const right = reference?.[field] ?? 0;
      if (left === right) continue;
      const finding = findingOf.get(`${personId}:${field}`);
      // An explanation covers the difference it was written for and no other.
      const explained = finding ? openDelta(finding) === left - right : false;
      differences.push({
        field,
        system: left,
        reference: right,
        delta: left - right,
        classification: explained ? finding!.classification : null,
        note: explained ? finding!.note : (finding?.note ?? null),
        stale: !!finding && !explained,
      });
    }

    const unexplained = differences.filter((line) => line.classification === null).length;
    return {
      personId,
      fullName: fact?.fullName ?? "—",
      employeeCode: fact?.employeeCode ?? null,
      presence: system && reference ? "both" : system ? "system_only" : "reference_only",
      differences,
      unexplained,
      matches: differences.length === 0 && !!system && !!reference,
    };
  });

  rows.sort((left, right) => right.unexplained - left.unexplained || (left.employeeCode ?? "").localeCompare(right.employeeCode ?? ""));
  const unexplainedLines = rows.reduce((total, row) => total + row.unexplained, 0);
  // Somebody missing from one side is itself a difference nobody has explained yet.
  const missingFromSystem = rows.filter((row) => row.presence === "reference_only").length;
  const missingFromReference = rows.filter((row) => row.presence === "system_only").length;

  return {
    entityId,
    month,
    hasReference: references.length > 0,
    rows,
    summary: {
      people: rows.length,
      matching: rows.filter((row) => row.matches).length,
      differing: rows.filter((row) => !row.matches).length,
      unexplainedLines,
      missingFromSystem,
      missingFromReference,
      zeroUnexplained: references.length > 0 && unexplainedLines === 0 && missingFromSystem === 0 && missingFromReference === 0,
    },
  };
}

/** The months of an entity that have reference figures, newest first — what the screen offers. */
export async function listParallelMonths(entityId: string, executor: Executor = db()): Promise<string[]> {
  const rows = await executor.selectDistinct({ month: schema.payrollParallelReference.month }).from(schema.payrollParallelReference).where(eq(schema.payrollParallelReference.entityId, entityId));
  return rows.map((row) => row.month).sort((left, right) => right.localeCompare(left));
}
