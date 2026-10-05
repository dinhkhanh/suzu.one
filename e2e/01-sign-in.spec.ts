// Journey 1 — sign-in (development plan §4): a person on each of the company's two Workspace
// domains reaches Today; a personal Gmail account is turned away. Google itself is not in the loop
// (see support/session.ts): the hosted-domain and allow-list rules are the sign-in policy's unit
// tests, and what is driven here is everything around them — the page, the error a refused
// account comes back to, and the server refusing a session that names nobody.
import { expect, test } from "@playwright/test";
import { closeSql } from "./support/db";
import { signIn } from "./support/session";

test.afterAll(closeSql);

test("the sign-in page offers Google, in the visitor's language", async ({ page, context }) => {
  await context.addCookies([{ name: "suzu_locale", value: "en", domain: "localhost", path: "/" }]);
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("a personal Gmail account comes back to a sentence saying why", async ({ page, context }) => {
  await context.addCookies([{ name: "suzu_locale", value: "en", domain: "localhost", path: "/" }]);
  await page.goto("/sign-in?error=not_a_workspace_account");
  await expect(page.getByText("Personal Gmail accounts are not allowed. Use your company email.")).toBeVisible();
});

test("a session for an account with no person behind it opens nothing", async ({ page, context }) => {
  await signIn(context, "someone@gmail.com");
  await page.goto("/today");
  await expect(page).toHaveURL(/\/sign-in/);
});

for (const [email, givenName] of [
  ["owner@suzu.vn", "Khánh"],
  ["bao.pham@suzu.group", "Bảo"],
] as const) {
  test(`${email.split("@")[1]}: a signed-in person lands on Today, greeted by name`, async ({ page, context }) => {
    await signIn(context, email);
    await page.goto("/today");
    await expect(page).toHaveURL(/\/today/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(givenName);
  });
}
