// Journey 6 — task create → review → done (development plan §4): a team member adds a task from
// Today, sends it to internal review, and closes it. The demo team's workflow is Vietnamese seed
// data, not interface text, so the states are named as the team named them.
import { expect, test } from "@playwright/test";
import { closeSql, sql } from "./support/db";
import { signIn } from "./support/session";
import { choose } from "./support/ui";

test.afterAll(closeSql);

const IN_REVIEW = "Duyệt nội bộ";
const DONE = "Đã báo cáo";

test("a task is created from Today, reviewed and done", async ({ page, context }) => {
  const title = `Dựng bản nháp TVC (e2e ${Date.now()})`;
  await signIn(context, "huy.ho@suzu.group");

  await page.goto("/today");
  await page.getByLabel("Add a task for today…").fill(title);
  await page.getByRole("button", { name: "Add task" }).click();
  await page.getByRole("link", { name: title }).first().click();
  await expect(page).toHaveURL(/\/work\/tasks\//);

  const stateOf = async () =>
    (await sql()<{ state: string; status: string }[]>`
      select s.name as state, t.status from task t join work_task w on w.task_id = t.id join work_state s on s.id = w.state_id where t.title = ${title}`)[0];

  await choose(page, "State", IN_REVIEW);
  await expect.poll(async () => (await stateOf())?.state).toBe(IN_REVIEW);
  await choose(page, "State", DONE);
  await expect.poll(stateOf).toEqual({ state: DONE, status: "done" });
});
