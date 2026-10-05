// Journey 7 — obligation complete with evidence (development plan §4): HR closes one of the
// month's compliance obligations, with what was done written on it.
//
// Obligations are made by the ops scheduler, which the suite runs first. Most templates ask for a
// file as proof (a filed form, a payment), and the CI job has no object storage behind it, so the
// journey uses the monthly probation review — an internal obligation whose evidence is the note
// HR writes. A store for files (MinIO as a service container, through R2_ENDPOINT) would let the
// suite upload proof as well.
import { expect, test } from "@playwright/test";
import { closeSql, sql } from "./support/db";
import { signIn } from "./support/session";
import { runJob } from "./support/ui";

test.afterAll(closeSql);

test("HR closes the month's probation review with a note of what was done", async ({ page, context, request }) => {
  await runJob(request, "ops-backfill");
  const [open] = await sql()<{ taskId: string }[]>`
    select oi.task_id as "taskId" from obligation_instance oi
      join obligation_template ot on ot.id = oi.template_id
      join task t on t.id = oi.task_id
    where ot.code = 'INT-PROBATION-REVIEW' and t.status not in ('done', 'cancelled')
    order by oi.period_key limit 1`;
  expect(open, "the scheduler made a probation review to close").toBeTruthy();

  const note = "Đã thu thập đánh giá của quản lý cho 1 nhân sự sắp hết thử việc (e2e).";
  await signIn(context, "mai.le@suzu.group");
  await page.goto(`/ops/obligations/${open.taskId}`);
  await page.getByLabel("Note").first().fill(note);
  await page.getByRole("button", { name: "Save progress" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark as done" }).click();
  await expect(page.getByText(/^Done/).first()).toBeVisible();

  const [closed] = await sql()<{ status: string; note: string | null }[]>`
    select t.status, oi.note from obligation_instance oi join task t on t.id = oi.task_id where oi.task_id = ${open.taskId}`;
  expect(closed).toEqual({ status: "done", note });
});
