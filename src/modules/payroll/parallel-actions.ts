"use server";
// Running payroll in parallel with the existing method (FR-PAY-38) and the year-to-date import
// (FR-PAY-35). Everything here takes `payroll:propose` over the entity — C&B and the owner.
//
// The audit rows say who typed or explained what, for which person and month, and never a figure:
// the amounts live encrypted in their own rows and are read back through the reconciliation.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { inTransaction } from "@/modules/core-hr/service";
import { COMPARED_FIELDS, removeReference, saveFinding, saveReference } from "./parallel";
import { parallelImport, parallelTemplate } from "./parallel-import";
import { canManageCompensation } from "./policy";
import { ytdImport, ytdTemplate } from "./ytd-import";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
// The entry form posts strings; the importer passes numbers. Both land as integer VND.
const vnd = z.coerce.number().int().min(0).max(100_000_000_000);

const refresh = () => revalidatePath("/payroll/parallel");

// ── The other method's figures, typed in for one person ─────────────────────────────────────

const setReferencePipeline = createAction({
  name: "payroll_parallel.set_reference",
  stepUp: true,
  input: z.object({
    entityId: z.uuid(),
    month,
    personId: z.uuid(),
    gross: vnd,
    employeeInsurance: vnd,
    unionDues: vnd,
    pit: vnd,
    otherDeductions: vnd,
    net: vnd,
    note: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(300).nullable().default(null)),
  }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const saved = await inTransaction((tx) =>
      saveReference(
        tx,
        { entityId: input.entityId, month: input.month, personId: input.personId, figures: { gross: input.gross, employeeInsurance: input.employeeInsurance, unionDues: input.unionDues, pit: input.pit, otherDeductions: input.otherDeductions, net: input.net }, note: input.note },
        user.person.id,
      ),
    );
    refresh();
    return { data: { id: saved.id }, audit: { resource: { type: "payroll_parallel_reference", id: saved.id, entityId: input.entityId }, summary: `reference figures ${input.month}`, after: { month: input.month, personId: input.personId } } };
  },
});
export async function setParallelReferenceAction(input: unknown) {
  return setReferencePipeline(input);
}

const removeReferencePipeline = createAction({
  name: "payroll_parallel.remove_reference",
  stepUp: true,
  input: z.object({ entityId: z.uuid(), month, personId: z.uuid() }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ input }) => {
    await removeReference(input.entityId, input.month, input.personId);
    refresh();
    return { data: { removed: true }, audit: { resource: { type: "payroll_parallel_reference", id: `${input.month}:${input.personId}`, entityId: input.entityId }, summary: `reference removed ${input.month}` } };
  },
});
export async function removeParallelReferenceAction(input: unknown) {
  return removeReferencePipeline(input);
}

// ── Explaining one difference ───────────────────────────────────────────────────────────────

const classifyPipeline = createAction({
  name: "payroll_parallel.classify",
  stepUp: true,
  input: z.object({
    entityId: z.uuid(),
    month,
    personId: z.uuid(),
    field: z.enum(COMPARED_FIELDS),
    /** The difference being explained: signed, and matched against the live figure on read. */
    delta: z.number().int(),
    classification: z.enum(["system_bug", "spreadsheet_error", "rule_gap", "accepted_rounding"]),
    // An explanation with no words is not an explanation; go-live turns on these being real.
    note: z.string().trim().min(3).max(1000),
  }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const saved = await inTransaction((tx) => saveFinding(tx, input, user.person.id));
    refresh();
    return {
      data: { id: saved.id },
      audit: { resource: { type: "payroll_parallel_finding", id: saved.id, entityId: input.entityId }, summary: `${input.field} ${input.classification} ${input.month}`, after: { field: input.field, classification: input.classification, month: input.month } },
    };
  },
});
export async function classifyParallelDifferenceAction(input: unknown) {
  return classifyPipeline(input);
}

// ── The two imports ─────────────────────────────────────────────────────────────────────────

export async function stageParallelImportAction(input: unknown) {
  return parallelImport.stage(input);
}
export async function commitParallelImportAction(input: unknown) {
  return parallelImport.commit(input);
}
export async function parallelTemplateAction() {
  return parallelTemplate();
}

export async function stageYtdImportAction(input: unknown) {
  return ytdImport.stage(input);
}
export async function commitYtdImportAction(input: unknown) {
  return ytdImport.commit(input);
}
export async function ytdTemplateAction() {
  return ytdTemplate();
}
