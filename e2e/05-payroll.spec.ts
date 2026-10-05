// Journey 5 — payroll run → payslip (development plan §4): C&B opens a run on the month journey 4
// locked, calculates and proposes it, the CEO approves it, C&B releases the payslips, and an
// employee reads theirs. Every payroll page and action asks for a fresh step-up (FR-PLT-06): the
// suite's sessions carry one (support/session.ts), as if each person had just been through Google.
import { expect, test } from "@playwright/test";
import { closeSql, sql } from "./support/db";
import { signIn } from "./support/session";
import { choose } from "./support/ui";

test.afterAll(closeSql);

test("a month's payroll goes from a new run to a payslip the employee can read", async ({ page, context }) => {
  // ── C&B: create, calculate, propose ──
  await signIn(context, "mai.le@suzu.group", { steppedUp: true });
  await page.goto("/payroll/runs/new");
  await choose(page, "Entity", /^SZM/);
  // The month list holds only locked months with no run yet: journey 4's month is the one there.
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/payroll\/runs\/[0-9a-f-]{36}/);
  const runUrl = page.url();

  await page.getByRole("button", { name: "Calculate", exact: true }).click();
  await expect(page.getByText("Calculated").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Propose", exact: true }).click();
  await expect(page.getByText("Proposed").first()).toBeVisible();

  // ── The CEO approves ──
  await context.clearCookies();
  await signIn(context, "ha.nguyen@suzu.vn", { steppedUp: true });
  await page.goto(runUrl);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();

  // ── C&B releases the payslips ──
  await context.clearCookies();
  await signIn(context, "mai.le@suzu.group", { steppedUp: true });
  await page.goto(runUrl);
  await page.getByRole("button", { name: "Release payslips" }).click();
  await expect(page.getByText(/^Released/).first()).toBeVisible();

  // ── An employee of the entity reads theirs ──
  await context.clearCookies();
  await signIn(context, "tam.bui@suzu.group", { steppedUp: true });
  await page.goto("/payslips");
  const runId = runUrl.split("/").at(-1)!.split(/[?#]/)[0];
  const [payslip] = await sql()<{ id: string }[]>`
    select s.id from payslip s join person p on p.id = s.person_id where s.run_id = ${runId} and p.work_email = 'tam.bui@suzu.group'`;
  expect(payslip, "the run made a payslip for the employee").toBeTruthy();
  await page.goto(`/payslips/${payslip.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/payslips/${payslip.id}`));
});
