// Journey 3 — leave request → approve (development plan §4): an employee asks for a day of annual
// leave, their line manager approves it, and the request says so.
import { expect, test } from "@playwright/test";
import { closeSql, sql } from "./support/db";
import { signIn } from "./support/session";
import { addDays, vietnamToday } from "./support/ui";

test.afterAll(closeSql);

const EMPLOYEE = "huy.ho@suzu.group";
const MANAGER = "long.dang@suzu.group";

/** The first weekday at least `notice` days ahead that the calendar does not mark (a holiday, a swap day). */
async function leaveDay(notice: number): Promise<string> {
  const marked = new Set((await sql()<{ date: string }[]>`select date::text as date from calendar_day where date >= current_date`).map((row) => row.date));
  for (let day = vietnamToday(), ahead = 0; ahead < 60; ahead++) {
    const candidate = addDays(day, notice + ahead);
    const weekday = new Date(`${candidate}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !marked.has(candidate)) return candidate;
  }
  throw new Error("e2e: no working day in the next two months");
}

test("an employee asks for a day of annual leave and their manager approves it", async ({ page, context }) => {
  const [annual] = await sql()<{ id: string }[]>`
    select id from leave_type where code = 'ANNUAL'
      and (entity_id is null or entity_id = (select id from entity where code = 'SZM'))
    order by entity_id nulls last limit 1`;
  // Annual leave asks for three days' notice.
  const day = await leaveDay(3);

  await signIn(context, EMPLOYEE);
  await page.goto(`/leave/new?type=${annual.id}&from=${day}&to=${day}`);
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.getByText(/Annual leave · 1 day/)).toBeVisible();
  await page.getByLabel("Reason").fill("Việc gia đình (e2e)");
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(page).toHaveURL(/\/approvals\/leave\//);
  await expect(page.getByText("Waiting for approval").first()).toBeVisible();
  const requestUrl = page.url();

  // The line manager opens the same request and approves it.
  await context.clearCookies();
  await signIn(context, MANAGER);
  await page.goto(requestUrl);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();

  const [request] = await sql()<{ status: string }[]>`
    select r.status from leave_request r join person p on p.id = r.person_id
    where p.work_email = ${EMPLOYEE} and r.start_date = ${day}::date order by r.created_at desc limit 1`;
  expect(request.status).toBe("approved");
});
