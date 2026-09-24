// Demo data for the ops tracker, local only. The instances come from the REAL scheduler: this
// script asks the running dev server to run the on-demand back-fill job (what fell due since the
// first day of last month, plus the next 100 days, for every entity, and the
// obligations pulled from the demo's HR events) and then dresses the result — older items closed
// with evidence (one of them late), a few left overdue, a few in progress.
// Order: `pnpm db:seed && pnpm db:seed:demo`, `pnpm dev` in another terminal, then `pnpm db:seed:demo:ops`.
// To start over: delete from stored_file where owner_type = 'obligation_instance'; delete from task where kind = 'obligation';
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { entity, obligationInstance, obligationTemplate, storedFile, task } from "../src/lib/db/schema";

config({ path: ".env.local" });

const RECEIPT = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

// Left open although long past due: what the dashboard and the escalation chain (week 5) need to show.
const LEFT_OVERDUE = new Set(["INT-INSURANCE-RECONCILE|SZC|2026-08", "EXT-UNION-FEE|SZM|2026-08", "EVT-HIRE-TAX-CODE|SZM"]);
// Closed after the deadline, with a receipt dated late.
const CLOSED_LATE = "EXT-VAT-MONTHLY|SZM|2026-07";

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set (see .env.example)");
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname) && process.env.DEMO_SEED_ALLOW_REMOTE !== "1") throw new Error("Demo data is for a local database only (set DEMO_SEED_ALLOW_REMOTE=1 for a staging database).");
  const base = process.env.RECOMPUTE_URL ?? "http://localhost:3000";
  if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("seed-demo-ops.ts only talks to a local server.");
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set in .env.local.");

  let response: Response;
  try {
    response = await fetch(`${base}/api/cron/ops-backfill`, { headers: { authorization: `Bearer ${secret}` } });
  } catch {
    console.log("The dev server is not running. Start it with `pnpm dev`, then run `pnpm db:seed:demo:ops`.");
    return;
  }
  console.log(`Scheduler: ${response.status} ${await response.text()}`);
  if (!response.ok) return;

  // `max_pipeline: 0` for the same reason as src/lib/db/index.ts: a pipelined query hangs behind the transaction pooler.
  const client = postgres(url, { prepare: false, max: 1, max_pipeline: 0 });
  const db = drizzle(client);
  const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);

  const [dressed] = await db.select({ id: obligationInstance.id }).from(obligationInstance).where(isNotNull(obligationInstance.referenceNumber)).limit(1);
  if (dressed) {
    console.log("Instances were already dressed (some are closed): nothing more to do.");
    await client.end();
    return;
  }

  const rows = await db
    .select({ instance: obligationInstance, row: task, template: obligationTemplate, entityCode: entity.code })
    .from(obligationInstance)
    .innerJoin(task, eq(task.id, obligationInstance.taskId))
    .innerJoin(obligationTemplate, eq(obligationTemplate.id, obligationInstance.templateId))
    .innerJoin(entity, eq(entity.id, obligationInstance.entityId))
    .where(and(inArray(task.status, ["todo", "in_progress"]), lt(task.dueDate, addDays(today, 16))));

  const storage = process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY) ? { base: `${process.env.SUPABASE_URL.replace(/\/$/, "")}/storage/v1`, key: (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, bucket: process.env.STORAGE_BUCKET ?? "suzu-private" } : null;
  if (storage) await fetch(`${storage.base}/bucket`, { method: "POST", headers: { authorization: `Bearer ${storage.key}`, "content-type": "application/json" }, body: JSON.stringify({ id: storage.bucket, name: storage.bucket, public: false }) }).catch(() => undefined);

  let closed = 0;
  let late = 0;
  let overdue = 0;
  let inProgress = 0;
  let files = 0;
  for (const { instance, row, template, entityCode } of rows) {
    const due = row.dueDate!;
    const key = instance.periodKey.startsWith("event:") ? `${template.code}|${entityCode}` : `${template.code}|${entityCode}|${instance.periodKey}`;
    const steps = Object.fromEntries(template.checklist.map((_, index) => [String(index), true]));

    if (due >= today) {
      // Due in the next two weeks: a few are being worked on.
      if (template.checklist.length > 1 && inProgress < 6) {
        await db.update(obligationInstance).set({ checklistState: { "0": true } }).where(eq(obligationInstance.id, instance.id));
        await db.update(task).set({ status: "in_progress" }).where(eq(task.id, row.id));
        inProgress++;
      }
      continue;
    }
    if (LEFT_OVERDUE.has(key)) {
      // One of each: a second hire's tax code is simply done.
      LEFT_OVERDUE.delete(key);
      overdue++;
      continue;
    }

    const isLate = key === CLOSED_LATE;
    const submitted = isLate ? addDays(due, 4) : addDays(due, -1);
    const closedBy = row.assigneePersonId;
    if (template.evidence.file) {
      const fileId = randomUUID();
      const objectPath = `obligation_instance/${due.slice(0, 4)}/${fileId}.pdf`;
      if (storage) await fetch(`${storage.base}/object/${storage.bucket}/${objectPath}`, { method: "POST", headers: { authorization: `Bearer ${storage.key}`, "content-type": "application/pdf" }, body: RECEIPT }).catch(() => undefined);
      await db.insert(storedFile).values({ id: fileId, bucket: storage?.bucket ?? "suzu-private", objectPath, fileName: `bien-nhan-${template.code.toLowerCase()}-${instance.periodKey.replace(/[^0-9a-zA-Z-]/g, "").slice(0, 12)}.pdf`, contentType: "application/pdf", sizeBytes: RECEIPT.length, ownerType: "obligation_instance", ownerId: instance.id, entityId: instance.entityId, tier: "public_internal", status: "ready", uploadedByPersonId: closedBy });
      files++;
    }
    await db
      .update(obligationInstance)
      .set({
        checklistState: steps,
        referenceNumber: template.evidence.reference ? `${template.authority === "tax" ? "TK" : "HS"}-${entityCode}-${due.replaceAll("-", "")}` : null,
        submittedDate: template.evidence.submittedDate ? submitted : null,
        amountPaid: template.evidence.amount ? (12_000_000 + ((instance.id.charCodeAt(0) * 37 + instance.id.charCodeAt(1)) % 90) * 1_000_000) : null,
        completedLate: isLate,
      })
      .where(eq(obligationInstance.id, instance.id));
    await db.update(task).set({ status: "done", completedAt: new Date(`${submitted}T09:30:00+07:00`), completedByPersonId: closedBy }).where(eq(task.id, row.id));
    closed++;
    if (isLate) late++;
  }
  console.log(`Dressed the instances: ${closed} closed with evidence (${late} late, ${files} receipts), ${overdue} left overdue, ${inProgress} in progress.`);
  await client.end();

  // Week 5: let the reminder job catch up on what was left overdue, so the dashboard shows the
  // escalation chain at work (owner and reviewer → manager → executives) and people have notices.
  const reminders = await fetch(`${base}/api/cron/ops-reminders`, { headers: { authorization: `Bearer ${secret}` } }).catch(() => null);
  console.log(`Reminders: ${reminders ? `${reminders.status} ${await reminders.text()}` : "the server did not answer"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
