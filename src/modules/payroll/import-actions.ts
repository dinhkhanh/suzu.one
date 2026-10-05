"use server";
// Salary structures and pay profiles from a spreadsheet (PAY-14), and the owner's approval of an
// import read on one screen. Every action asks for a recent re-authentication (FR-PLT-06).
//
// What reaches the audit log: the import, how many were approved and which were refused, by id —
// never a figure.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { approveProfileImport, profileImport, profileTemplate } from "./profile-import";
import { canDecidePayRules } from "./policy";
import { approveSalaryImport, salaryImport, salaryTemplate } from "./salary-import";

const refresh = (batchId: string) => {
  revalidatePath("/payroll/salaries");
  revalidatePath("/payroll/profiles");
  revalidatePath("/approvals");
  revalidatePath(`/payroll/salaries/imports/${batchId}`);
};

export async function stageSalaryImportAction(input: unknown) {
  return salaryImport.stage(input);
}
export async function commitSalaryImportAction(input: unknown) {
  return salaryImport.commit(input);
}
export async function salaryTemplateAction() {
  return salaryTemplate();
}

export async function stageProfileImportAction(input: unknown) {
  return profileImport.stage(input);
}
export async function commitProfileImportAction(input: unknown) {
  return profileImport.commit(input);
}
export async function profileTemplateAction() {
  return profileTemplate();
}

// ── The owner approves what they have read ──────────────────────────────────────────────────

const approval = z.object({ batchId: z.uuid(), ids: z.array(z.uuid()).min(1).max(5000) });

const approveSalariesPipeline = createAction({
  name: "salary_change.approve_import",
  stepUp: true,
  input: approval,
  // The owner signs salaries (SRS D17). Each request is then decided through the approval engine,
  // which still asks whether it is this person's turn on that request.
  authorize: (user) => canDecidePayRules(user.principal),
  run: async ({ user, input }) => {
    const result = await approveSalaryImport({ personId: user.person.id, principal: user.principal }, input.batchId, input.ids);
    refresh(input.batchId);
    return { data: result, audit: { resource: { type: "import:payroll_salary", id: input.batchId }, summary: `approved ${result.approved} of ${input.ids.length}`, after: { approved: result.approved, failed: result.failed } } };
  },
});
export async function approveSalaryImportAction(input: unknown) {
  return approveSalariesPipeline(input);
}

const approveProfilesPipeline = createAction({
  name: "pay_profile.approve_import",
  stepUp: true,
  input: approval,
  // Putting someone on a profile is the owner's call (FR-PAY-07).
  authorize: (user) => canDecidePayRules(user.principal),
  run: async ({ user, input }) => {
    const result = await approveProfileImport(user.person.id, input.batchId, input.ids);
    refresh(input.batchId);
    return { data: result, audit: { resource: { type: "import:payroll_profile", id: input.batchId }, summary: `approved ${result.approved} of ${input.ids.length}`, after: { approved: result.approved, failed: result.failed } } };
  },
});
export async function approveProfileImportAction(input: unknown) {
  return approveProfilesPipeline(input);
}
