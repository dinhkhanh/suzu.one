// Value lists shared by the server and the forms. Plain module: never "use client".

// What a unit is called. A "team" may hold teams and a "department" may hold departments — the
// name is a label for people, not a level (FR-PLT-16); only the two derived placement columns
// (`person.department_id`, `person.team_id`) read it.
export const ORG_UNIT_KINDS = ["department", "team"] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];
