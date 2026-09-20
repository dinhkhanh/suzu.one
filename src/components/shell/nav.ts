import type { Principal } from "@/modules/platform/rbac/policy";
import { can } from "@/modules/platform/rbac/policy";

export type NavItem = { key: string; href?: string; phase?: number };

// Modules without an href are not built yet; they show with the phase they arrive in.
export function navFor(principal: Principal, open: { people: boolean }): { main: NavItem[]; admin: NavItem[] } {
  const main: NavItem[] = [
    { key: "home", href: "/home" },
    // Announcements aimed at the reader; kudos are about the directory, which collaborators do not have.
    { key: "announcements", href: "/announcements" },
    ...(principal.workforceType === "collaborator" ? [] : [{ key: "kudos", href: "/kudos" }]),
    { key: "checkIn", href: "/attendance/check-in" },
    { key: "me", href: "/me" },
    ...(open.people ? [{ key: "people", href: "/people" }] : []),
    ...(can(principal, "report:read") ? [{ key: "reports", href: "/reports/headcount" }] : []),
    { key: "attendance", href: "/attendance" },
    { key: "leave", href: "/leave" },
    // Purchase, payment, advance, a confirmation letter — the request builder's types (FR-REQ-01).
    { key: "requests", href: "/requests" },
    { key: "work", href: "/work" },
    // Equipment: everyone has their own, so the entry always shows; the register behind it is for
    // whoever keeps one, and /assets sends anybody else to their own list.
    { key: "assets", href: can(principal, "asset:manage") ? "/assets" : "/assets/mine" },
    // Compliance: people with an ops role. Anyone else reaches their own obligations through My work.
    ...(can(principal, "ops:read") || can(principal, "ops:manage") ? [{ key: "ops", href: "/ops" }] : []),
    // Goals and KPIs: everyone has their own; what else they see is decided on the pages.
    { key: "performance", href: "/performance" },
    // The knowledge base: which spaces open is decided by their access rows, on the pages.
    { key: "kb", href: "/kb" },
    // Pay: everyone has their own payslips; the desk behind them is decided on the pages.
    { key: "payslips", href: "/payslips" },
    { key: "payroll", href: "/payroll" },
  ];
  // Navigation visibility only. Every page and action re-checks permissions itself.
  const admin: NavItem[] = [
    ...(can(principal, "org:read") ? [{ key: "entities", href: "/admin/entities" }, { key: "org", href: "/admin/org" }] : []),
    ...(can(principal, "org:manage", {}) ? [{ key: "flags", href: "/admin/flags" }] : []),
    ...(can(principal, "person:manage") ? [{ key: "checklists", href: "/admin/checklists" }] : []),
    ...(can(principal, "org:manage") ? [{ key: "approvalFlows", href: "/admin/approval-flows" }, { key: "requestTypes", href: "/admin/request-types" }] : []),
    ...(can(principal, "rbac:manage") ? [{ key: "roles", href: "/admin/roles" }] : []),
    ...(can(principal, "rules:propose", {}) || can(principal, "payroll:rules", {}) || can(principal, "payroll:read", {}) ? [{ key: "rules", href: "/admin/rules" }] : []),
    ...(can(principal, "audit:read") ? [{ key: "audit", href: "/admin/audit" }] : []),
    ...(can(principal, "audit:read", {}) ? [{ key: "jobs", href: "/admin/jobs" }] : []),
  ];
  return { main, admin };
}
