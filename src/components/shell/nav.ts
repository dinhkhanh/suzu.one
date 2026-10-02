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
    // One entry for everybody: the page links on to the other kinds of request, and to the claims
    // desk (FR-REQ-03) for whoever pays the payroll.
    { key: "requests", href: "/requests" },
    { key: "work", href: "/work" },
    // The checklist library: every department's tick-lists, open to the whole company; HR's
    // onboarding and offboarding templates sit on the same page for HR.
    ...(principal.workforceType !== "collaborator" || can(principal, "person:manage") ? [{ key: "checklists", href: "/checklists" }] : []),
    // Projects & daily work (Phase 10): the portfolio lists only what the reader may open; the day
    // (plans, reports, the team board for leads) decides the rest on its pages.
    { key: "projects", href: "/projects" },
    { key: "daily", href: "/daily" },
    // Time on tasks (FR-PJM-24); approving weeks and utilisation are reached from the day's pages.
    { key: "time", href: "/daily/time" },
    // Clients & sales (Phase 11): the account list is every employee's, as the client list was;
    // the pipeline, contracts and receivables decide on their own pages what the reader holds. A
    // collaborator on an account's team reaches it from their project instead.
    ...(principal.workforceType === "collaborator" ? [] : [{ key: "crm", href: "/crm" }]),
    // Finance's ready-to-invoice queue (FR-PJM-56): whoever holds `pjm:commercial` anywhere.
    ...(can(principal, "pjm:commercial") ? [{ key: "billing", href: "/projects/billing" }] : []),
    // Receivables (FR-CRM-32): finance and the sales directors; account managers find them on the CRM's tabs.
    ...(can(principal, "pjm:commercial") || can(principal, "crm:manage") ? [{ key: "receivables", href: "/crm/invoices" }] : []),
    // Capacity (FR-PJM-13) for leaders over a scope; team leads also reach it from their projects.
    // The grant clause of `canOpenCapacity` and nothing else: `pjm:portfolio` is finance's way into
    // project pages since 2026-09-23 and opens no capacity page, so offering the entry to it only
    // links to a 404.
    ...(can(principal, "work:manage") ? [{ key: "capacity", href: "/projects/capacity" }] : []),
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
    // Ask SuZu: everybody may ask; what it can answer is decided per asker by the same access
    // rows, in SQL, on every question. Somebody who can open no page gets "I do not know".
    { key: "assistant", href: "/assistant" },
    // Referring somebody is everybody's (FR-REC-10) — the programme only works if the whole
    // company can find it — so the entry does not depend on recruitment access. It opens the form
    // and the person's own referrals, and nothing of the candidate database.
    ...(principal.workforceType === "collaborator" ? [] : [{ key: "referrals", href: "/recruit/referrals" }]),
    // Pay: everyone has their own payslips; the desk behind them is decided on the pages.
    { key: "payslips", href: "/payslips" },
    { key: "payroll", href: "/payroll" },
    // Feedback on SuZu One: everybody's, collaborators included — they use the app too. The header
    // button sends it from any page; this is where one's own items and the replies are.
    { key: "feedback", href: "/feedback" },
  ];
  // Navigation visibility only. Every page and action re-checks permissions itself.
  const admin: NavItem[] = [
    ...(can(principal, "org:read") ? [{ key: "entities", href: "/admin/entities" }, { key: "org", href: "/admin/org" }] : []),
    ...(can(principal, "org:manage", {}) ? [{ key: "flags", href: "/admin/flags" }] : []),
    ...(can(principal, "person:manage") ? [{ key: "documentTemplates", href: "/admin/document-templates" }] : []),
    ...(can(principal, "org:manage") ? [{ key: "approvalFlows", href: "/admin/approval-flows" }, { key: "requestTypes", href: "/admin/request-types" }] : []),
    ...(can(principal, "rbac:manage") ? [{ key: "roles", href: "/admin/roles" }] : []),
    ...(can(principal, "rules:propose", {}) || can(principal, "payroll:rules", {}) || can(principal, "payroll:read", {}) ? [{ key: "rules", href: "/admin/rules" }] : []),
    ...(can(principal, "audit:read") ? [{ key: "audit", href: "/admin/audit" }] : []),
    ...(can(principal, "audit:read", {}) ? [{ key: "jobs", href: "/admin/jobs" }] : []),
    // The feedback inbox: whoever triages it or reads it, over any scope.
    ...(can(principal, "feedback:manage") || can(principal, "feedback:read") ? [{ key: "feedbackInbox", href: "/feedback/inbox" }] : []),
  ];
  return { main, admin };
}

export type NavGroupKey = "today" | "me" | "work" | "manage" | "company" | "preferences" | "admin";

/**
 * The sidebar's sections, each a fold of its own, and the entries in each in the order drawn. An
 * entry is offered or not by `navFor`; this only says where an offered one sits. `nav.test.ts`
 * holds every entry to a section, so a new one cannot quietly land in the fallback.
 */
export const NAV_GROUPS: readonly { key: NavGroupKey; keys: readonly string[] }[] = [
  // What waits for the person today: the landing page (My work under its tabs) and the inboxes with their counts.
  { key: "today", keys: ["today", "approvals", "notifications"] },
  // One's own matters: the profile, the clock, time off, requests, pay, goals, one's equipment.
  { key: "me", keys: ["me", "checkIn", "attendance", "leave", "requests", "payslips", "performance", "assets"] },
  // The work itself, as somebody doing it.
  { key: "work", keys: ["work", "projects", "daily", "time", "checklists", "crm", "bookings", "interviews"] },
  // The desks over other people's work: reports, capacity, money in and out, hiring, compliance.
  { key: "manage", keys: ["reports", "capacity", "billing", "receivables", "recruit", "payroll", "ops"] },
  // What the whole company shares.
  { key: "company", keys: ["home", "announcements", "kudos", "people", "kb", "assistant", "referrals", "feedback"] },
  // How the app behaves for this person; the language and the theme switches sit under these rows.
  { key: "preferences", keys: ["notificationSettings"] },
  { key: "admin", keys: ["entities", "org", "flags", "documentTemplates", "approvalFlows", "requestTypes", "roles", "rules", "audit", "jobs", "feedbackInbox"] },
];

/** Where an entry no section names is drawn, rather than not at all. */
const FALLBACK_GROUP: NavGroupKey = "work";

/** The offered entries, sorted into their sections; a section with nothing offered is left out. */
export function groupNav<Item extends { key: string }>(items: readonly Item[]): { key: NavGroupKey; items: Item[] }[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const placed = new Set(NAV_GROUPS.flatMap((group) => group.keys));
  return NAV_GROUPS.map((group) => ({
    key: group.key,
    items: [
      ...group.keys.flatMap((key) => byKey.get(key) ?? []),
      ...(group.key === FALLBACK_GROUP ? items.filter((item) => !placed.has(item.key)) : []),
    ],
  })).filter((group) => group.items.length > 0);
}
