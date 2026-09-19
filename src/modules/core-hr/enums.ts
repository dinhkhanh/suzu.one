// Value lists shared by the actions (validation), the pages and the client forms.
// A plain module: constants exported from a "use client" file are not usable on the server.
export const WORKFORCE_TYPES = ["employee", "probation", "intern", "part_time", "collaborator", "advisor"] as const;
export const PERSON_STATUSES = ["active", "preboarding", "suspended", "offboarded"] as const;
export const GENDERS = ["male", "female", "other"] as const;
export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed"] as const;
