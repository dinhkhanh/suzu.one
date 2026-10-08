// What the journeys share: the house Select, the Vietnamese calendar day, a scheduled job run on
// demand, and a confirmation that may be the browser's or the app's own.
import { type APIRequestContext, expect, type Page } from "@playwright/test";

/**
 * Picks `option` in the house Select (`src/components/ui/select.tsx`, a Base UI combobox that reads
 * like a native select). A short list opens from a button; a long one is a search box to type in.
 */
export async function choose(page: Page, label: string, option: string | RegExp): Promise<void> {
  const control = page.getByLabel(label, { exact: true }).first();
  await control.click();
  if ((await control.evaluate((element) => element.tagName)) === "INPUT" && typeof option === "string") await control.fill(option);
  await page.getByRole("option", { name: option }).first().click();
}

/** Today in Vietnam, `YYYY-MM-DD` — the app's calendar, whatever the machine's. */
export function vietnamToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The month before `iso`'s, `YYYY-MM`. */
export function previousMonth(iso: string): string {
  const date = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

/**
 * Runs one scheduled job through the cron route, as Vercel Cron would. Some of what a journey needs
 * exists only once a job made it (timesheet days, the month's obligations): the demo seed is data,
 * the jobs turn it into the day's state.
 */
export async function runJob(request: APIRequestContext, job: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("e2e: CRON_SECRET is not set — the suite runs jobs through /api/cron");
  const response = await request.get(`/api/cron/${job}`, { headers: { authorization: `Bearer ${secret}` }, timeout: 300_000 });
  expect(response.status(), `${job}: ${await response.text()}`).toBe(200);
}

/**
 * Clicks `button` and says yes to the confirmation that follows — the browser's own
 * (`window.confirm`) or the app's dialog, whichever this build shows.
 */
export async function clickAndConfirm(page: Page, button: ReturnType<Page["getByRole"]>, confirmName: RegExp): Promise<void> {
  page.once("dialog", (dialog) => void dialog.accept());
  await button.click();
  // The app asks in its own ConfirmDialog (components/ui/confirm.tsx), a plain `dialog` — a sheet
  // on a phone; an `alertdialog` is accepted too.
  const dialog = page
    .getByRole("alertdialog")
    .or(page.getByRole("dialog"))
    .filter({ has: page.getByRole("button", { name: confirmName }) });
  const shown = await dialog
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (shown) await dialog.getByRole("button", { name: confirmName }).click();
}
