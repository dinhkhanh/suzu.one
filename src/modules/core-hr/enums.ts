// Value lists shared by the actions (validation), the pages and the client forms.
// A plain module: constants exported from a "use client" file are not usable on the server.
export const WORKFORCE_TYPES = ["employee", "probation", "intern", "part_time", "collaborator", "advisor"] as const;
export const PERSON_STATUSES = ["active", "preboarding", "suspended", "offboarded"] as const;
export const GENDERS = ["male", "female", "other"] as const;
export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed"] as const;
export const CONTRACT_TYPES = ["probation", "fixed_term", "indefinite", "service", "internship", "nda", "appendix"] as const;
export const JOB_CATEGORIES = ["manager", "professional", "intermediate", "other"] as const;
export const DEPENDENT_RELATIONSHIPS = ["child", "spouse", "parent", "parent_in_law", "sibling", "grandparent", "other"] as const;
export const DOCUMENT_CATEGORIES = ["id_scan", "degree", "certificate", "health_check", "contract", "decision", "other"] as const;
// Restricted-tier fields of a person; each is one encrypted column of `person_sensitive`.
export const SENSITIVE_TEXT_FIELDS = ["nationalId", "nationalIdIssuedOn", "nationalIdIssuedAt", "passportNumber", "taxCode", "socialInsuranceNumber", "healthInsuranceHospital"] as const;
// What an employee may ask to change through a change request (FR-CHR-12). Name, work email, date of
// birth and gender are HR's to correct; the bank account is requested as one block of its own.
export const PERSONAL_CHANGE_FIELDS = ["phone", "personalEmail", "permanentAddress", "currentAddress", "maritalStatus"] as const;
export const RESTRICTED_CHANGE_FIELDS = ["nationalId", "nationalIdIssuedOn", "nationalIdIssuedAt", "taxCode", "socialInsuranceNumber"] as const;
export const LIFECYCLE_EVENT_TYPES = ["hire", "rehire", "probation_pass", "probation_fail", "contract_renewal", "transfer", "promotion", "salary_change", "discipline", "reward", "long_leave", "resignation", "termination"] as const;
// Events HR writes down by hand with no side effects. The others are written by the use-case
// that makes them true (hire, change of assignment, termination, an approved resignation).
export const RECORD_ONLY_EVENT_TYPES = ["probation_pass", "probation_fail", "contract_renewal", "salary_change", "discipline", "reward", "long_leave"] as const;
// What a change of assignment is, for the timeline. A correction fixes a mistake and is no event.
export const ASSIGNMENT_CHANGE_KINDS = ["correction", "transfer", "promotion"] as const;
export const TERMINATION_REASONS = ["resignation", "contract_end", "probation_fail", "mutual_agreement", "dismissal", "retirement", "other"] as const;
