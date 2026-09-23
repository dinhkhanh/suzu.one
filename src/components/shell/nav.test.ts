// Navigation is cosmetic — every page re-checks — but an entry that always lands on a 404 is a
// bug of its own, so the entries gated on a permission are kept in step with the page behind them.
import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { navFor } from "./nav";

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
