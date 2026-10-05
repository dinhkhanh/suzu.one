// Journey 4 — timesheet lock (development plan §4): HR closes last month's timesheet for an entity.
// Timesheet days are written by the nightly recompute, which the suite runs first; the demo month
// still has things HR would chase (unapproved days, missing punches), so the lock is the override
// with a recorded reason — the path a real month-end most often takes.
//
// Payroll (journey 5) runs on the month this locks.
import { expect, test } from "@playwright/test";
import { closeSql, sql } from "./support/db";
import { signIn } from "./support/session";
import { clickAndConfirm, previousMonth, runJob, vietnamToday } from "./support/ui";

test.afterAll(closeSql);

test("HR locks last month's timesheet for SuZu Media", async ({ page, context, request }) => {
  await runJob(request, "timesheet-recompute");
  const month = previousMonth(vietnamToday());
  const [entity] = await sql()<{ id: string }[]>`select id from entity where code = 'SZM'`;

  await signIn(context, "bao.pham@suzu.group");
  await page.goto(`/attendance/timesheets?month=${month}&entity=${entity.id}`);
  await expect(page.getByText("Lock the month")).toBeVisible();

  const reason = page.getByLabel("Why lock anyway? (at least 10 characters)");
  if (await reason.isVisible()) {
    await reason.fill("Khóa để chạy bảng lương kiểm thử (e2e).");
    await clickAndConfirm(page, page.getByRole("button", { name: "Lock anyway" }), /lock/i);
  } else {
    await clickAndConfirm(page, page.getByRole("button", { name: "Lock", exact: true }), /lock/i);
  }

  await expect(page.getByText(/^Locked on /)).toBeVisible({ timeout: 30_000 });
  const [period] = await sql()<{ count: number }[]>`
    select count(*)::int as count from timesheet_period where entity_id = ${entity.id} and month = ${month} and locked_at is not null`;
  expect(period.count).toBe(1);
});
