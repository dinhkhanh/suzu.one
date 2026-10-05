# Incidents

Something is wrong in production. This page is the order to work in, and how the warnings that start it are set up.

## What warns you

| Signal | What it means | Set up |
|---|---|---|
| **Uptime check** on `/api/health` fails | The app does not answer, or answers but cannot reach the database through the pooler | Once, below |
| **Cron switch** for `midnight` / `morning` / `evening` is late or reports a failure | A schedule never fired, died without a word, or a job in it failed | Once, below |
| In-app notice **"Scheduled job failed"** / **"stopped before it finished"** (to the owners) | One job failed, or the platform killed a run that outlived its five minutes | Built in; Admin → Jobs shows the runs |
| Admin → Jobs **"Failed deliveries"** tile is red | Emails, pushes, Chat, Messenger or Telegram messages the outboxes gave up on in the last 7 days — a provider key expired, a quota ran out | Built in; open it weekly |
| **Sentry** new issue | An error a person or a job hit. Only the `production` environment matters | Built in (`SENTRY_DSN`) |
| People say so | Anything | — |

### Setting up the uptime check (owner, once, 10 minutes)

Any external monitor works; [healthchecks.io](https://healthchecks.io) and [Better Stack](https://betterstack.com/uptime) both have a free tier. With Better Stack (or UptimeRobot):

1. New monitor → type **HTTP(s) keyword** or **status code** → URL `https://<app domain>/api/health`.
2. Expect status **200** (and, for a keyword monitor, the text `"ok":true`). Interval **1 minute**; region **Singapore** if offered; timeout 10 s.
3. Alert after **2 consecutive failures** (one is a cold start or a deploy), to the owner's email and phone app. Quiet hours: none — NFR-OPS-01's window is Mon–Sat 07:00–22:00, but an outage at 23:00 is still better known at 23:00.
4. Check it works: in the monitor, "Send test alert"; and once, after a deploy, watch a check go through.

`/api/health` answers anyone, says only `{"ok":true}` or `{"ok":false}` (503), and costs one `select 1`. It is not behind a sign-in on purpose.

### Setting up the cron switch (owner, once, 10 minutes)

The schedules ping a dead-man's switch when `CRON_PING_URL` is set: `<base>/<schedule>/start` when a schedule starts, then `<base>/<schedule>` when it finishes or `<base>/<schedule>/fail` when a job in it failed. A schedule that never pings — Vercel did not fire it, the function died — is noticed by the service, not by us.

1. [healthchecks.io](https://healthchecks.io) → new project "SuZu One" → Settings → **Ping key**: create one. The base is `https://hc-ping.com/<ping key>`.
2. Add three checks, with **slugs** exactly `midnight`, `morning`, `evening`, schedule type **Cron**, timezone **UTC**, and the expressions from `vercel.json`: `5 17 * * *`, `0 0 * * *`, `0 11 * * *`. Grace time **20 minutes** (a schedule may hand its tail to a second invocation; the whole run takes about 2 minutes today).
3. Integrations → email (and the phone app) to the owner.
4. Vercel → the project → Settings → Environment Variables → `CRON_PING_URL` = `https://hc-ping.com/<ping key>` for **Production only** (a preview must not ping production's checks). Redeploy.
5. The next morning, all three checks show a green ping.

## When it fires: the order

1. **Is it real?** Open `https://<app domain>/api/health` and the app itself. Vercel → the project → **Observability / Logs** for the last 15 minutes. Supabase → the project's status and **Reports**. [status.supabase.com](https://status.supabase.com) and [vercel-status.com](https://www.vercel-status.com) for an outage that is theirs.
2. **Tell people** (Chat space / Zalo group) that it is known and being looked at, if they will notice it. One line; no guess at the cause.
3. **Did it start with a deploy?** Vercel → Deployments: a production deploy in the hour before → roll back first, investigate after ([rollback.md](rollback.md)). That fixes most incidents in five minutes.
4. **The database.** `/api/health` says `ok:false` while Supabase is up:
   - Supabase → Database → **Query performance** / `select pid, state, wait_event, xact_start, query from pg_stat_activity where state <> 'idle' order by xact_start` — a backend `active` in `ClientRead` with a minutes-old `xact_start` is the pooler wedge of September 2026 (`max_pipeline: 0` in `src/lib/db/index.ts` is its fix); `select pg_terminate_backend(<pid>)` clears it.
   - Connections at the limit (Supabase → Reports → Database connections): an instance storm; redeploying recycles them.
5. **A job.** Admin → Jobs → the failed run's error. Fix the cause, then **Run now** on that job (owner). Jobs are written to be safe to run again. A schedule whose tail did not run (`cron.continuation_failed` in the logs, or a "fail" ping with no failed job) — run the jobs that have no run today by hand, in the order of `src/app/api/cron/registry.ts`.
6. **Deliveries.** The failed-delivery tile: Resend (email), the VAPID keys (push), the Chat webhook, the Messenger page token, the Telegram bot token — whichever channel is counted. Fix the key in Vercel, redeploy; the morning `notifications-daily` job retries what is still pending (failed rows are not retried: they were given up on).
7. **Data looks wrong.** Stop and read [restore.md](restore.md) before changing anything by hand.

## After the incident

Within a day, add a short entry to the incident log (a page in the owner's notes or `docs/` — the orchestrator decides where): when it started, when it was noticed and by what, what was done, when it ended, what people lost, and the one change that would have prevented or shortened it. Personal data that leaked or may have leaked is a breach under Decree 13/2023 and Law 91/2025: the 72-hour notification clock starts at discovery (NFR-PRV-01) — tell the owner and counsel the same day.
