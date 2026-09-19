import type { Principal } from "@/modules/platform/rbac/policy";
import { can } from "@/modules/platform/rbac/policy";

export type NavItem = { key: string; href?: string; phase?: number };

// Modules without an href are not built yet; they show with the phase they arrive in.
export function navFor(principal: Principal): { main: NavItem[]; admin: NavItem[] } {
  const main: NavItem[] = [
    { key: "home", href: "/home" },
    { key: "people", phase: 1 },
    { key: "attendance", phase: 2 },
    { key: "leave", phase: 2 },
    { key: "work", phase: 3 },
    { key: "ops", phase: 3 },
    { key: "kb", phase: 4 },
    { key: "payroll", phase: 5 },
  ];
  // Navigation visibility only. Every page and action re-checks permissions itself.
  const admin: NavItem[] = can(principal, "org:read") ? [{ key: "entities", href: "/admin/entities" }] : [];
  return { main, admin };
}
