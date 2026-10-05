// Who may see and keep an entity's paying bank accounts (FR-PLT-11, FR-PAY-33). Pure; no I/O.
//
// They are the company's own accounts — nothing about a person — so no sensitivity tier applies.
// What is limited is who has a reason to look: the people who pay from them and the people who
// read payroll. Reading the entity's page (`org:read`) alone does not show them.
import { can, type Principal } from "../rbac/policy";

/**
 * Add, change, switch off: whoever keeps the entity's details (`org:manage`) **or** the chief
 * accountant, whose accounts they are (`payroll:pay`) — either one, over that entity.
 */
export const canKeepEntityBankAccounts = (principal: Principal, entityId: string): boolean => can(principal, "org:manage", { entityId }) || can(principal, "payroll:pay", { entityId });

/** See them: the keepers, and anyone who reads the entity's payroll (`payroll:read`). */
export const canSeeEntityBankAccounts = (principal: Principal, entityId: string): boolean => canKeepEntityBankAccounts(principal, entityId) || can(principal, "payroll:read", { entityId });
