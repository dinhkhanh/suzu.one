// What each encrypted payroll value is bound to (see src/lib/crypto/field-cipher.ts): a ciphertext
// copied into another row or column fails to decrypt. A plain module — the services and the demo
// seed (which runs under tsx and cannot load `server-only` code) must build the same strings.
export const salaryTermsContext = (structureId: string) => `salary_structure.terms:${structureId}`;
/** The proposed terms of a `salary_change` request, in the approval request's `payload_enc`. */
export const salaryChangeContext = (requestId: string) => `approval_request.payload:${requestId}`;
