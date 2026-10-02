// Navigation is cosmetic — every page re-checks — but an entry that always lands on a 404 is a
// bug of its own, so the entries gated on a permission are kept in step with the page behind them.
import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { groupNav, NAV_GROUPS, navFor } from "./nav";

const group = { type: "group" } as const;
const principal = (grants: Grant[]): Principal => ({ personId: "me", workforceType: "employee", grants });
const closed = { people: false, recruit: false, interviews: false };
const hrefs = (grants: Grant[]) => navFor(principal(grants), closed).main.map((item) => item.href);

describe("navigation entries behind a permission", () => {
  it("offers capacity to whoever runs teams, and not to finance", () => {
    // `canOpenCapacity` (projects/policy.ts) asks `work:manage`, never `pjm:portfolio` — which
    // finance has held since 2026-09-23 to read the projects it invoices, and which opens no
    // capacity page. Offering the entry to finance would only link it to a 404.
    for (const role of ["c_level", "entity_director", "department_head"] as const) {
      expect(hrefs([{ role, scope: group }])).toContain("/projects/capacity");
    }
    for (const role of ["finance", "payroll", "hr_admin", "hr_staff", "auditor"] as const) {
      expect(hrefs([{ role, scope: group }])).not.toContain("/projects/capacity");
    }
  });

  it("offers the billing queue to whoever holds pjm:commercial, and the portfolio to everybody", () => {
    expect(hrefs([{ role: "finance", scope: group }])).toContain("/projects/billing");
    expect(hrefs([{ role: "payroll", scope: group }])).not.toContain("/projects/billing");
    // The portfolio lists only what the reader may open, so its entry is not gated at all.
    expect(hrefs([])).toContain("/projects");
  });
});

describe("clients and sales", () => {
  it("offers the CRM to every employee, not to a collaborator", () => {
    expect(hrefs([])).toContain("/crm");
    expect(navFor({ personId: "me", workforceType: "collaborator", grants: [] }, closed).main.map((item) => item.href)).not.toContain("/crm");
  });

  it("offers receivables to finance and sales directors, as the receivables page does", () => {
    for (const role of ["finance", "c_level", "entity_director"] as const) expect(hrefs([{ role, scope: group }]), role).toContain("/crm/invoices");
    for (const role of ["sales", "payroll", "hr_admin", "department_head"] as const) expect(hrefs([{ role, scope: group }]), role).not.toContain("/crm/invoices");
  });
});

describe("feedback", () => {
  const admin = (grants: Grant[]) => navFor(principal(grants), closed).admin.map((item) => item.href);

  it("offers everybody, collaborators included, the way to send feedback", () => {
    expect(hrefs([])).toContain("/feedback");
    expect(navFor({ personId: "me", workforceType: "collaborator", grants: [] }, closed).main.map((item) => item.href)).toContain("/feedback");
  });

  it("offers the inbox to whoever triages or reads feedback, as the inbox page does", () => {
    for (const role of ["owner", "hr_admin", "c_level", "entity_director"] as const) expect(admin([{ role, scope: group }]), role).toContain("/feedback/inbox");
    for (const role of ["hr_staff", "department_head", "finance"] as const) expect(admin([{ role, scope: group }]), role).not.toContain("/feedback/inbox");
  });
});

describe("sidebar sections", () => {
  const everything = navFor(principal([{ role: "owner", scope: group }]), { people: true, recruit: true, interviews: true });
  const offered = [{ key: "today" }, { key: "approvals" }, { key: "notifications" }, { key: "notificationSettings" }, ...everything.main, ...everything.admin];

  it("names a section for every entry the sidebar can offer", () => {
    const named = new Set(NAV_GROUPS.flatMap((section) => section.keys));
    expect(offered.map((item) => item.key).filter((key) => !named.has(key))).toEqual([]);
  });

  it("places every entry once, in its section's order, and drops empty sections", () => {
    const grouped = groupNav(offered);
    expect(grouped.flatMap((section) => section.items)).toHaveLength(new Set(offered.map((item) => item.key)).size);
    expect(grouped[0]).toEqual({ key: "today", items: [{ key: "today" }, { key: "approvals" }, { key: "notifications" }] });
    expect(groupNav([{ key: "kb" }, { key: "home" }])).toEqual([{ key: "company", items: [{ key: "home" }, { key: "kb" }] }]);
  });

  it("still draws an entry no section names", () => {
    expect(groupNav([{ key: "somethingNew" }])).toEqual([{ key: "work", items: [{ key: "somethingNew" }] }]);
  });
});
