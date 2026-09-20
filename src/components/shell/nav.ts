import type { Principal } from "@/modules/platform/rbac/policy";
import { can } from "@/modules/platform/rbac/policy";

export type NavItem = { key: string; href?: string; phase?: number };

// Modules without an href are not built yet; they show with the phase they arrive in.
export function navFor(principal: Principal, open: { people: boolean; recruit: boolean; interviews: boolean }): { main: NavItem[]; admin: NavItem[] } {
  const main: NavItem[] = [
    { key: "home", href: "/home" },
    // Announcements aimed at the reader; kudos are about the directory, which collaborators do not have.
    { key: "announcements", href: "/announcements" },
    ...(principal.workforceType === "collaborator" ? [] : [{ key: "kudos", href: "/kudos" }]),
    { key: "checkIn", href: "/attendance/check-in" },
    { key: "me", href: "/me" },
    ...(open.people ? [{ key: "people", href: "/people" }] : []),
    // The overview (FR-RPT-01 v2) decides tile by tile what this reader may see, so the entry is
    // not gated on one permission; the page itself shows only the tiles they hold. Cosmetic, as ever.
    { key: "reports", href: "/reports" },
    { key: "attendance", href: "/attendance" },
    { key: "leave", href: "/leave" },
    // Purchase, payment, advance, a confirmation letter — the request builder's types (FR-REQ-01).
    // Whoever pays the payroll also settles the expense claims (FR-REQ-03), so their entry is the
    // claims desk rather than their own filed requests.
    { key: "requests", href: can(principal, "payroll:pay") ? "/requests/claims" : "/requests" },
    { key: "work", href: "/work" },
    // Equipment: everyone has their own, so the entry always shows; the register behind it is for
    // whoever keeps one, and /assets sends anybody else to their own list.
    { key: "assets", href: can(principal, "asset:manage") ? "/assets" : "/assets/mine" },
    // Shared production gear is common property (see assets/policy.ts), so the calendar is for
    // everybody — the camera operator who needs the lens on Friday most of all.
    { key: "bookings", href: "/assets/bookings" },
    // Compliance: people with an ops role. Anyone else reaches their own obligations through My work.
    ...(can(principal, "ops:read") || can(principal, "ops:manage") ? [{ key: "ops", href: "/ops" }] : []),
    // Goals and KPIs: everyone has their own; what else they see is decided on the pages.
    { key: "performance", href: "/performance" },
    // Recruitment: whoever runs it, and whoever sits on a hiring team — the second is a row in
    // `job_opening_member`, not a role, so the layout has to ask. Cosmetic: every page re-checks.
    ...(open.recruit ? [{ key: "recruit", href: "/recruit" }] : []),
    // My interviews (FR-REC-06). A separate entry because a colleague brought in for one technical
    // round is on no hiring team at all: this list is the whole of their access to recruitment.
    ...(open.interviews ? [{ key: "interviews", href: "/recruit/interviews" }] : []),
    // The knowledge base: which spaces open is decided by their access rows, on the pages.
    { key: "kb", href: "/kb" },
    // Ask Suzu: everybody may ask; what it can answer is decided per asker by the same access
    // rows, in SQL, on every question. Somebody who can open no page gets "I do not know".
    { key: "assistant", href: "/assistant" },
    // Referring somebody is everybody's (FR-REC-10) — the programme only works if the whole
    // company can find it — so the entry does not depend on recruitment access. It opens the form
    // and the person's own referrals, and nothing of the candidate database.
    ...(principal.workforceType === "collaborator" ? [] : [{ key: "referrals", href: "/recruit/referrals" }]),
    // Pay: everyone has their own payslips; the desk behind them is decided on the pages.
    { key: "payslips", href: "/payslips" },
    { key: "payroll", href: "/payroll" },
  ];
  // Navigation visibility only. Every page and action re-checks permissions itself.
  const admin: NavItem[] = [
    ...(can(principal, "org:read") ? [{ key: "entities", href: "/admin/entities" }, { key: "org", href: "/admin/org" }] : []),
    ...(can(principal, "org:manage", {}) ? [{ key: "flags", href: "/admin/flags" }] : []),
    ...(can(principal, "person:manage") ? [{ key: "checklists", href: "/admin/checklists" }, { key: "documentTemplates", href: "/admin/document-templates" }] : []),
    ...(can(principal, "org:manage") ? [{ key: "approvalFlows", href: "/admin/approval-flows" }, { key: "requestTypes", href: "/admin/request-types" }] : []),
    ...(can(principal, "rbac:manage") ? [{ key: "roles", href: "/admin/roles" }] : []),
    ...(can(principal, "rules:propose", {}) || can(principal, "payroll:rules", {}) || can(principal, "payroll:read", {}) ? [{ key: "rules", href: "/admin/rules" }] : []),
    ...(can(principal, "audit:read") ? [{ key: "audit", href: "/admin/audit" }] : []),
    ...(can(principal, "audit:read", {}) ? [{ key: "jobs", href: "/admin/jobs" }] : []),
  ];
  return { main, admin };
}
