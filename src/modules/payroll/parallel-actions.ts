"use server";
// Running payroll in parallel with the existing method (FR-PAY-38) and the year-to-date import
// (FR-PAY-35). Everything here takes `payroll:propose` over the entity — C&B and the owner.
//
// The audit rows say who typed or explained what, for which person and month, and never a figure:
// the amounts live encrypted in their own rows and are read back through the reconciliation.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { createAction } from "@/lib/action";
import { inTransaction } from "@/modules/core-hr/service";
import { type ExportColumn, toCsv } from "@/modules/platform/export/csv";
import { COMPARED_FIELDS, parallelCsvRows, reconcile, removeReference, saveFinding, saveReference, signOffParallel } from "./parallel";
import { parallelImport, parallelTemplate } from "./parallel-import";
import { canManageCompensation } from "./policy";
import { ytdImport, ytdTemplate } from "./ytd-import";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
// The entry form posts strings; the importer passes numbers. Both land as integer VND.
const vnd = z.coerce.number().int().min(0).max(100_000_000_000);
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

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
    // What the person cost the company on the other method's sheet — optional: not every sheet has it.
    employerCost: z.preprocess(blankToNull, vnd.nullable().default(null)),
    note: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? null : value), z.string().trim().max(300).nullable().default(null)),
  }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const saved = await inTransaction((tx) =>
      saveReference(
        tx,
        { entityId: input.entityId, month: input.month, personId: input.personId, figures: { gross: input.gross, employeeInsurance: input.employeeInsurance, unionDues: input.unionDues, pit: input.pit, otherDeductions: input.otherDeductions, net: input.net, employerCost: input.employerCost }, note: input.note },
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

// ── Signing a month off, and the report as a file (FR-PAY-38) ───────────────────────────────

const signOffPipeline = createAction({
  name: "payroll_parallel.sign_off",
  stepUp: true,
  input: z.object({ entityId: z.uuid(), month, checkedWith: z.preprocess(blankToNull, z.string().trim().max(200).nullable().default(null)), note: z.preprocess(blankToNull, z.string().trim().max(1000).nullable().default(null)) }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const signed = await signOffParallel(input, user.person.id);
    refresh();
    // Counts and who it was checked with — the record itself holds nothing more.
    return { data: { id: signed.id }, audit: { resource: { type: "payroll_parallel_signoff", id: signed.id, entityId: input.entityId }, summary: `parallel run ${input.month} signed off`, after: { month: input.month, people: signed.people, matching: signed.matching, explainedLines: signed.explainedLines, checkedWith: signed.checkedWith } } };
  },
});
export async function signOffParallelAction(input: unknown) {
  return signOffPipeline(input);
}

/**
 * The reconciliation as a spreadsheet, for the chief accountant's file. It comes back through the
 * action's result and is saved by the browser — never stored. The audit row names the month and the
 * number of rows, never a figure.
 */
const exportPipeline = createAction({
  name: "payroll_parallel.export",
  stepUp: true,
  input: z.object({ entityId: z.uuid(), month }),
  authorize: (user, input) => canManageCompensation(user.principal, { entityId: input.entityId }),
  run: async ({ input }) => {
    const [report, t] = await Promise.all([reconcile(input.entityId, input.month), getTranslations("payroll.parallel")]);
    type Row = ReturnType<typeof parallelCsvRows>[number];
    const columns: ExportColumn<Row>[] = [
      { header: t("export.employeeCode"), value: ({ row }) => row.employeeCode },
      { header: t("person"), value: ({ row }) => row.fullName },
      { header: t("export.presence"), value: ({ row }) => (row.presence === "both" ? "" : t(`presence.${row.presence}`)) },
      ...COMPARED_FIELDS.flatMap((field): ExportColumn<Row>[] => [
        { header: `${t(`fields.${field}`)} — ${t("export.system")}`, value: ({ row }) => row.system?.[field] ?? null },
        { header: `${t(`fields.${field}`)} — ${t("export.reference")}`, value: ({ row }) => row.reference?.[field] ?? null },
        { header: `${t(`fields.${field}`)} — ${t("export.difference")}`, value: ({ row }) => (row.system && typeof row.reference?.[field] === "number" ? (row.system[field] ?? 0) - row.reference[field] : null) },
      ]),
      { header: t("unexplained"), value: ({ row }) => row.unexplained },
      { header: t("export.explanations"), value: ({ explained }) => explained },
    ];
    const rows = parallelCsvRows(report);
    return {
      data: { fileName: `doi-chieu-${input.month}.csv`, content: toCsv(columns, rows), contentType: "text/csv; charset=utf-8" },
      audit: { resource: { type: "payroll_parallel_export", id: input.month, entityId: input.entityId }, summary: `parallel run ${input.month} exported`, after: { month: input.month, rows: rows.length } },
    };
  },
});
export async function exportParallelReportAction(input: unknown) {
  return exportPipeline(input);
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
