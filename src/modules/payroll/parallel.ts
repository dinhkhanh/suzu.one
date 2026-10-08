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
import { and, desc, eq, max, ne } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
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
 * components, which no two of them do the same way — and, when the spreadsheet has it, what the
 * person cost the company (gross + employer insurance + union fund). Rows typed before the
 * employer cost was asked for simply have none, and it is then not compared.
 */
export type ReferenceFigures = {
  gross: number;
  employeeInsurance: number;
  unionDues: number;
  pit: number;
  otherDeductions: number;
  net: number;
  employerCost?: number | null;
};

/** The fields compared, in the order the report shows them. */
export const COMPARED_FIELDS = ["gross", "employeeInsurance", "unionDues", "pit", "otherDeductions", "net", "employerCost"] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export const EMPTY_REFERENCE: ReferenceFigures = { gross: 0, employeeInsurance: 0, unionDues: 0, pit: 0, otherDeductions: 0, net: 0, employerCost: 0 };

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
  await executor.delete(schema.payrollParallelReference).where(and(eq(schema.payrollParallelReference.entityId, entityId), eq(schema.payrollParallelReference.month, month), eq(schema.payrollParallelReference.personId, personId)));
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
  /** Each side's figures for the month, whole — the report shows them beside each other. null = that side has nobody. */
  system: ReferenceFigures | null;
  reference: ReferenceFigures | null;
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
    /** Differences somebody has explained, by size — what a sign-off accepts. */
    explainedLines: number;
    /** The one number go-live turns on (development plan §3, Phase 5). */
    zeroUnexplained: boolean;
  };
  /**
   * The month on each side: what was paid in hand and what it cost the company. The reference's
   * employer cost counts only the people whose spreadsheet row gives one (`withEmployerCost`).
   */
  totals: { system: { net: number; employerCost: number }; reference: { net: number; employerCost: number; withEmployerCost: number } };
};

const systemFigures = (result: ReturnType<typeof openResult>): ReferenceFigures => ({
  gross: result.totals.grossEarnings,
  employeeInsurance: result.totals.employeeInsurance,
  unionDues: result.totals.unionDues,
  pit: result.totals.pit,
  otherDeductions: result.totals.otherDeductions,
  net: result.totals.net,
  employerCost: result.totals.employerCost,
});

const addFigures = (left: ReferenceFigures, right: ReferenceFigures): ReferenceFigures => ({
  gross: left.gross + right.gross,
  employeeInsurance: left.employeeInsurance + right.employeeInsurance,
  unionDues: left.unionDues + right.unionDues,
  pit: left.pit + right.pit,
  otherDeductions: left.otherDeductions + right.otherDeductions,
  net: left.net + right.net,
  employerCost: (left.employerCost ?? 0) + (right.employerCost ?? 0),
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
    executor
      .select()
      .from(schema.payrollParallelReference)
      .where(and(eq(schema.payrollParallelReference.entityId, entityId), eq(schema.payrollParallelReference.month, month))),
    executor
      .select()
      .from(schema.payrollParallelFinding)
      .where(and(eq(schema.payrollParallelFinding.entityId, entityId), eq(schema.payrollParallelFinding.month, month))),
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
      // A spreadsheet that gives no employer cost is not said to differ on it.
      if (field === "employerCost" && reference && (reference.employerCost === undefined || reference.employerCost === null)) continue;
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
      system: system ?? null,
      reference: reference ?? null,
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
  const explainedLines = rows.reduce((total, row) => total + row.differences.length - row.unexplained, 0);
  // The month on each side. Decrypted figures are added up here because only here are they in the clear.
  const withEmployerCost = rows.filter((row) => typeof row.reference?.employerCost === "number");

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
      explainedLines,
      zeroUnexplained: references.length > 0 && unexplainedLines === 0 && missingFromSystem === 0 && missingFromReference === 0,
    },
    totals: {
      system: { net: rows.reduce((sum, row) => sum + (row.system?.net ?? 0), 0), employerCost: rows.reduce((sum, row) => sum + (row.system?.employerCost ?? 0), 0) },
      reference: { net: rows.reduce((sum, row) => sum + (row.reference?.net ?? 0), 0), employerCost: withEmployerCost.reduce((sum, row) => sum + (row.reference!.employerCost ?? 0), 0), withEmployerCost: withEmployerCost.length },
    },
  };
}

/** The months of an entity that have reference figures, newest first — what the screen offers. */
export async function listParallelMonths(entityId: string, executor: Executor = db()): Promise<string[]> {
  const rows = await executor.selectDistinct({ month: schema.payrollParallelReference.month }).from(schema.payrollParallelReference).where(eq(schema.payrollParallelReference.entityId, entityId));
  return rows.map((row) => row.month).sort((left, right) => right.localeCompare(left));
}

// ── Signing off a month (FR-PAY-38) ─────────────────────────────────────────────────────────

export type ParallelSignoff = {
  id: string;
  signedAt: Date;
  signedByPersonId: string;
  signedByName: string | null;
  people: number;
  matching: number;
  explainedLines: number;
  checkedWith: string | null;
  note: string | null;
  /** Still what the reconciliation says: nothing was recalculated, re-imported or re-explained since. */
  current: boolean;
};

/**
 * A month's sign-offs, newest first, each saying whether it still holds. A sign-off is of the
 * reconciliation as it stood: when a run of the month is calculated again, a reference figure is
 * typed or imported, an explanation is written, or the counts no longer agree, it no longer covers
 * the month and a new one is needed. Times and counts — never a figure.
 */
export async function listParallelSignoffs(entityId: string, month: string, summary: Reconciliation["summary"], executor: Executor = db()): Promise<ParallelSignoff[]> {
  const signoff = schema.payrollParallelSignoff;
  const reference = schema.payrollParallelReference;
  const finding = schema.payrollParallelFinding;
  const run = schema.payrollRun;
  const inMonth = (table: { entityId: AnyPgColumn; month: AnyPgColumn }) => and(eq(table.entityId, entityId), eq(table.month, month));
  // The last moment anything the reconciliation is made of changed: three aggregates beside the rows.
  const [rows, [references], [findings], [runs]] = await Promise.all([
    executor.select({ row: signoff, signedByName: schema.person.fullName }).from(signoff).leftJoin(schema.person, eq(schema.person.id, signoff.signedByPersonId)).where(inMonth(signoff)).orderBy(desc(signoff.signedAt)),
    executor
      .select({ at: max(reference.updatedAt) })
      .from(reference)
      .where(inMonth(reference)),
    executor
      .select({ at: max(finding.updatedAt) })
      .from(finding)
      .where(inMonth(finding)),
    executor
      .select({ at: max(run.calculatedAt) })
      .from(run)
      .where(inMonth(run)),
  ]);
  const lastChange = Math.max(0, ...[references?.at, findings?.at, runs?.at].map((at) => (at ? new Date(at).getTime() : 0)));
  return rows.map(({ row, signedByName }) => ({
    id: row.id,
    signedAt: row.signedAt,
    signedByPersonId: row.signedByPersonId,
    signedByName: signedByName ?? null,
    people: row.people,
    matching: row.matching,
    explainedLines: row.explainedLines,
    checkedWith: row.checkedWith,
    note: row.note,
    current: summary.zeroUnexplained && row.signedAt.getTime() >= lastChange && row.people === summary.people && row.matching === summary.matching && row.explainedLines === summary.explainedLines,
  }));
}

/**
 * Records that a month's reconciliation was looked at and accepted. Only a month with nothing left
 * unexplained can be signed off — that is the state go-live needs — and the record keeps the counts
 * it was accepted on and who it was checked with on the other method's side.
 */
export async function signOffParallel(input: { entityId: string; month: string; checkedWith: string | null; note: string | null }, actorPersonId: string, executor: Executor = db()) {
  const report = await reconcile(input.entityId, input.month, executor);
  if (!report.summary.zeroUnexplained) throw new ActionError("parallel_not_clean");
  const [created] = await executor
    .insert(schema.payrollParallelSignoff)
    .values({
      entityId: input.entityId,
      month: input.month,
      people: report.summary.people,
      matching: report.summary.matching,
      explainedLines: report.summary.explainedLines,
      checkedWith: input.checkedWith,
      note: input.note,
      signedByPersonId: actorPersonId,
    })
    .returning();
  return created;
}

/** The report as a spreadsheet: one row per person, each figure on both sides and the difference. */
export function parallelCsvRows(report: Reconciliation) {
  return report.rows.map((row) => ({
    row,
    explained: row.differences
      .filter((line) => line.classification)
      .map((line) => `${line.field}: ${line.classification}${line.note ? ` (${line.note})` : ""}`)
      .join("; "),
  }));
}
