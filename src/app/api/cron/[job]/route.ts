import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { env } from "@/lib/env";
import { pingSchedule, type JobOutcome, runJob, runSchedule, sweepTimedOutRuns } from "@/modules/platform/jobs/service";
import { jobNamed, SCHEDULES } from "../registry";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const statusOf = (outcomes: JobOutcome[]) => (outcomes.some((outcome) => outcome.status === "failed") ? 500 : 200);

/**
 * Runs a schedule from job `from` onwards within this invocation's time budget, then hands what is
 * left to a fresh invocation of this same URL — a function of its own, with five minutes of its own
 * (ENG-01). The last invocation of the chain pings the dead-man's switch with the verdict of the
 * whole run; `failed` carries the earlier invocations' part of it along.
 */
async function continueSchedule(request: Request, schedule: string, from: number, failedBefore: boolean): Promise<JobOutcome[]> {
  const startedAt = new Date();
  const progress = await runSchedule(SCHEDULES[schedule], from, { startedAt });
  const failed = failedBefore || progress.outcomes.some((outcome) => outcome.status === "failed");
  if (progress.next === null) {
    await pingSchedule(env().CRON_PING_URL, schedule, failed ? "fail" : "success");
    return progress.outcomes;
  }
  const next = new URL(request.url);
  next.search = new URLSearchParams({ from: String(progress.next), ...(failed ? { failed: "1" } : {}) }).toString();
  try {
    // The next invocation answers at once and does its work after answering, so this waits seconds, not minutes.
    const handed = await fetch(next, { headers: { authorization: request.headers.get("authorization") ?? "" }, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!handed.ok) throw new Error(`continuation answered ${handed.status}`);
  } catch (error) {
    // The tail did not start: fail the run loudly. The jobs left will run at the next trigger.
    console.error(JSON.stringify({ level: "error", event: "cron.continuation_failed", schedule, from: progress.next, message: error instanceof Error ? error.message : String(error) }));
    await pingSchedule(env().CRON_PING_URL, schedule, "fail");
  }
  return progress.outcomes;
}

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. Nothing else may.
// `/api/cron/<schedule>` runs a whole schedule; `/api/cron/<job name>` runs one job (by hand, or a
// job with its own frequent cron, which first asks the job whether it is `due`);
// `/api/cron/<schedule>?from=<n>` is a schedule handing its tail on to itself.
export async function GET(request: Request, context: RouteContext<"/api/cron/[job]">) {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const { job } = await context.params;
  const query = new URL(request.url).searchParams;

  // Whatever died with its server since the last call is marked failed, and the owners hear of it.
  await sweepTimedOutRuns();

  if (SCHEDULES[job]) {
    const from = Number(query.get("from") ?? 0);
    if (!Number.isInteger(from) || from < 0 || from >= SCHEDULES[job].length) return new Response("Bad continuation", { status: 400 });
    if (from > 0) {
      // A continuation: answer the invocation that handed over, then work.
      after(() => continueSchedule(request, job, from, query.get("failed") === "1"));
      return Response.json({ accepted: { schedule: job, from } }, { status: 202 });
    }
    await pingSchedule(env().CRON_PING_URL, job, "start");
    const outcomes = await continueSchedule(request, job, 0, false);
    return Response.json({ outcomes }, { status: statusOf(outcomes) });
  }

  const definition = jobNamed(job);
  if (!definition) return new Response("Unknown job", { status: 404 });
  if (definition.due && !(await definition.due())) return Response.json({ outcomes: [{ job: definition.name, status: "not_due", result: null, error: null }] satisfies JobOutcome[] });
  const run = await runJob(definition);
  const outcomes: JobOutcome[] = [{ job: definition.name, status: run?.status === "succeeded" || run?.status === "failed" ? run.status : "already_running", result: run?.result ?? null, error: run?.error ?? null }];
  return Response.json({ outcomes }, { status: statusOf(outcomes) });
}
