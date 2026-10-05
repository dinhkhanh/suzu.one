// Journey 2 — check-in (development plan §4): an employee checks in from their phone, at the
// office, and the day shows it. The demo's punches end in September 2026, so today starts empty.
import { expect, test } from "@playwright/test";
import { closeSql, sql } from "./support/db";
import { signIn } from "./support/session";
import { vietnamToday } from "./support/ui";

test.afterAll(closeSql);

/** SuZu Media's office in the demo seed (120 m radius). */
const OFFICE = { latitude: 10.778203, longitude: 106.702143 };

test("an employee checks in at the office from their phone", async ({ page, context }) => {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ ...OFFICE, accuracy: 20 });
  await signIn(context, "tam.bui@suzu.group");

  await page.goto("/attendance/check-in");
  await page.getByRole("button", { name: "Check in", exact: true }).click();

  await expect(page.getByText(/^Checked in at \d{1,2}:\d{2}/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Check out", exact: true })).toBeVisible();

  // And it is a punch of today's, recorded for this person.
  const [punch] = await sql()<{ count: number }[]>`
    select count(*)::int as count from punch p join person on person.id = p.person_id
    where person.work_email = 'tam.bui@suzu.group' and (p.at at time zone 'Asia/Ho_Chi_Minh')::date = ${vietnamToday()}::date`;
  expect(punch.count).toBeGreaterThan(0);
});
