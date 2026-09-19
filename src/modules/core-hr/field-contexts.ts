// What each encrypted value of this module is bound to (see src/lib/crypto/field-cipher.ts): a
// ciphertext copied into another row or column fails to decrypt. A plain module, because the
// service, the re-wrap job and the demo seed must all build exactly the same strings.
const snake = (field: string) => field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

export const sensitiveContext = (field: string, personId: string) => `person_sensitive.${snake(field)}:${personId}`;
export const contractTermsContext = (contractId: string) => `contract.salary_terms:${contractId}`;
export const dependentContext = (field: "idNumber" | "taxCode", dependentId: string) => `dependent.${snake(field)}:${dependentId}`;
export const changeRequestContext = (requestId: string) => `approval_request.payload:${requestId}`;

export const NATIONAL_ID_INDEX_CONTEXT = "person.national_id";
/** ID numbers are compared without spaces, dots or case. */
export const normalizeIdNumber = (value: string) => value.replace(/[\s.-]/g, "").toUpperCase();
