// What each encrypted payroll value is bound to (see src/lib/crypto/field-cipher.ts): a ciphertext
// copied into another row or column fails to decrypt. A plain module — the services and the demo
// seed (which runs under tsx and cannot load `server-only` code) must build the same strings.
export const salaryTermsContext = (structureId: string) => `salary_structure.terms:${structureId}`;
/** The proposed terms of a `salary_change` request, in the approval request's `payload_enc`. */
export const salaryChangeContext = (requestId: string) => `approval_request.payload:${requestId}`;

/** A run's totals, and one person's calculated result and the input it was calculated from. */
export const runTotalsContext = (runId: string) => `payroll_run.totals:${runId}`;
export const runResultContext = (runPersonId: string) => `payroll_run_person.result:${runPersonId}`;
export const runInputContext = (runPersonId: string) => `payroll_run_person.input:${runPersonId}`;
/** A figure typed into a run for one person (a bonus, an advance). */
export const runEntryContext = (entryId: string) => `payroll_run_input.amount:${entryId}`;
/** A difference belonging to a month already paid (FR-PAY-17). */
export const retroAmountContext = (itemId: string) => `payroll_retro_item.amount:${itemId}`;
