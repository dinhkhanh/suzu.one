import type { Principal } from "@/modules/platform/rbac/policy";
import { can } from "@/modules/platform/rbac/policy";

export type NavItem = { key: string; href?: string; phase?: number };

// Modules without an href are not built yet; they show with the phase they arrive in.
export function navFor(principal: Principal, open: { people: boolean }): { main: NavItem[]; admin: NavItem[] } {
  const main: NavItem[] = [
    { key: "home", href: "/home" },
    { key: "checkIn", href: "/attendance/check-in" },
    { key: "me", href: "/me" },
    ...(open.people ? [{ key: "people", href: "/people" }] : []),
    ...(can(principal, "report:read") ? [{ key: "reports", href: "/reports/headcount" }] : []),
    { key: "attendance", href: "/attendance" },
    { key: "leave", href: "/leave" },
    { key: "work", phase: 3 },
    { key: "ops", phase: 3 },
    { key: "kb", phase: 4 },
    { key: "payroll", phase: 5 },
  ];
  // Navigation visibility only. Every page and action re-checks permissions itself.
  const admin: NavItem[] = [
    ...(can(principal, "org:read") ? [{ key: "entities", href: "/admin/entities" }, { key: "org", href: "/admin/org" }] : []),
    ...(can(principal, "org:manage", {}) ? [{ key: "flags", href: "/admin/flags" }] : []),
    ...(can(principal, "person:manage") ? [{ key: "checklists", href: "/admin/checklists" }] : []),
    ...(can(principal, "org:manage") ? [{ key: "approvalFlows", href: "/admin/approval-flows" }] : []),
    ...(can(principal, "rbac:manage") ? [{ key: "roles", href: "/admin/roles" }] : []),
    ...(can(principal, "rules:propose", {}) || can(principal, "payroll:rules", {}) || can(principal, "payroll:read", {}) ? [{ key: "rules", href: "/admin/rules" }] : []),
    ...(can(principal, "audit:read") ? [{ key: "audit", href: "/admin/audit" }] : []),
    ...(can(principal, "audit:read", {}) ? [{ key: "jobs", href: "/admin/jobs" }] : []),
  ];
  return { main, admin };
}
