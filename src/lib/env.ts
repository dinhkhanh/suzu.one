import "server-only";
import { z } from "zod";

const csv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

// Variable names follow the Vercel–Supabase integration, so production, previews and a laptop
// running `vercel env pull` are configured by the same names (README, "Environment").
const schema = z.object({
  // The pooled connection (Supavisor, transaction mode). Migrations use POSTGRES_URL_NON_POOLING
  // (drizzle.config.ts), never this one.
  POSTGRES_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  BETTER_AUTH_SECRET: z.string().min(32, "generate with: openssl rand -base64 32"),
  BETTER_AUTH_URL: z.url(),
  // The outward-facing domain (e.g. https://suzu.vn) that serves only the client review links
  // (/preview), the careers pages (/careers) and a company home page of its own, so links handed to
  // clients and candidates never name the internal app's domain. Unset = one domain serves
  // everything, as before, and the company home page is at /portfolio (src/lib/site.ts).
  PUBLIC_SITE_URL: z.url().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_WORKSPACE_DOMAINS: z.string().default("suzu.vn,suzu.group,bambooads.net"),
  BOOTSTRAP_OWNER_EMAILS: z.string().default(""),
  // Field encryption for restricted/compensation data: "k2:<base64 32 bytes>,k1:<...>", active key
  // first (docs/KEY_ROTATION.md). Losing these keys loses the data; they live only in the secret store.
  DATA_ENCRYPTION_KEYS: z.string().min(1).optional(),
  DATA_BLIND_INDEX_KEY: z.string().min(1).optional(),
  // The Cloudflare account that holds the file bucket (R2) and runs the embeddings (Workers AI).
  CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, "the 32-character account ID from the Cloudflare dashboard").optional(),
  // Private file storage (Cloudflare R2, over its S3-compatible API). An R2 API token's access key
  // pair, scoped to the one bucket with Object Read & Write; server-only. `R2_ENDPOINT` overrides
  // the account's endpoint (https://<account>.r2.cloudflarestorage.com) for another S3-compatible
  // store. Unset = uploads and downloads fail with "storage_not_configured".
  R2_ACCESS_KEY_ID: z.string().min(1).optional(),
  R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  R2_ENDPOINT: z.url().optional(),
  STORAGE_BUCKET: z.string().regex(/^[a-z0-9-]+$/).default("suzu-private"),
  // Outgoing email (Resend). Unset = emails are written to the outbox and marked "skipped".
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("SuZu One <no-reply@suzu.one>"),
  // Web push (VAPID, RFC 8292). Generate a pair with: pnpm push:keys. Unset = pushes are recorded as
  // "simulated" and nothing leaves the machine; browsers cannot subscribe without the public key.
  VAPID_PUBLIC_KEY: z.string().min(80).optional(),
  VAPID_PRIVATE_KEY: z.string().min(40).optional(),
  VAPID_SUBJECT: z.string().default("mailto:it@suzu.one"),
  // Embeddings for the knowledge base (Cloudflare Workers AI, called over its REST API): an API
  // token from the dashboard's "Workers AI" template, limited to CLOUDFLARE_ACCOUNT_ID. Unset = a deterministic
  // local fake: chunks are still cut, stored and ranked, but the vectors mean nothing outside this
  // machine.
  CLOUDFLARE_AI_API_TOKEN: z.string().min(1).optional(),
  EMBEDDINGS_MODEL: z.string().min(1).default("@cf/baai/bge-m3"),
  // The assistant's models (Phase 9, FR-AI-01; SRS D38). Unset key = the local extractive driver:
  // it answers with the knowledge base's own words, generates nothing, and nothing leaves the
  // machine. With a key the Claude drivers run, on the owner's own Anthropic account (D38: its
  // standard retention applies, not zero data retention). Three tiers: SIMPLE (Haiku) for look-ups
  // and handbook answers, the plain model (Sonnet) for complex turns, COMPLEX (Opus) for the
  // hardest answers only.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Only for a key that is not scoped to a workspace: the workspace every request is billed to.
  ANTHROPIC_WORKSPACE_ID: z.string().min(1).optional(),
  ANTHROPIC_MODEL_SIMPLE: z.string().min(1).default("claude-haiku-4-5"),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-5-5"),
  ANTHROPIC_MODEL_COMPLEX: z.string().min(1).default("claude-opus-5-5"),
  // The kill switch (FR-AGT-52): "off" sends no question and no draft to any model, whatever the
  // key — the assistant answers the free way, as it did before it had a key.
  AI_AGENT_ENABLED: z.enum(["on", "off"]).default("on"),
  // Who gets the agent — the model choosing among the app's tools (Phase 13) — rather than Phase 9's
  // assistant: "pilot" is the owners and the work emails listed in AI_AGENT_PILOT_EMAILS (comma-
  // separated), "everyone" is everybody. Everybody else keeps the handbook answers and the four
  // personal tools.
  AI_AGENT_AUDIENCE: z.enum(["pilot", "everyone"]).default("pilot"),
  AI_AGENT_PILOT_EMAILS: z.string().default(""),
  // What the assistant may cost (D35), in US dollars: the whole company per calendar month
  // (Vietnamese time), and one person per day by band — everybody, people who lead work, and the
  // office (HR, payroll, finance, directors, C-level, owner). Spent = the free way until it resets.
  AI_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(150),
  AI_DAILY_BUDGET_USD_EVERYONE: z.coerce.number().nonnegative().default(0.3),
  AI_DAILY_BUDGET_USD_LEADS: z.coerce.number().nonnegative().default(0.75),
  AI_DAILY_BUDGET_USD_OFFICE: z.coerce.number().nonnegative().default(1.5),
  // Step-up re-authentication before compensation screens (FR-PLT-06). "google" sends the person
  // through Google again; "local" is a confirm button for development machines, where Google
  // cannot be reached — `load()` refuses it in any production build or on Vercel.
  STEP_UP_DRIVER: z.enum(["google", "local"]).default("google"),
  // Shared with Vercel Cron, which sends it as a bearer token. Unset = scheduled jobs refuse to run.
  CRON_SECRET: z.string().min(16).optional(),
  // A dead-man's switch for the schedules (ENG-01, docs/runbooks/incidents.md): a ping URL base at
  // an uptime service, e.g. healthchecks.io's `https://hc-ping.com/<ping key>`. Each schedule pings
  // `<base>/<schedule>/start`, then `<base>/<schedule>` or `<base>/<schedule>/fail`; the service
  // alerts when a ping is late. Unset = no pings.
  CRON_PING_URL: z.url().optional(),
  // Google Chat (FR-PLT-31): an incoming-webhook URL for the space that gets approval cards.
  // Unset = the local driver records each card as "simulated" and nothing leaves the machine.
  GOOGLE_CHAT_WEBHOOK_URL: z.url().optional(),
  // Facebook Messenger (docs/MESSENGER.md): a company Page whose bot delivers each person's own
  // notifications to the Messenger account they linked. The first four are needed together — with
  // any missing, the local driver records each message as "simulated" and nothing leaves the
  // machine. The app secret signs Meta's webhook calls and our Graph calls (appsecret_proof); the
  // verify token is any random string, typed into the webhook settings once. `PAGE_USERNAME` is the
  // m.me handle the "connect" link opens. `UTILITY_TEMPLATE` is the approved utility template used
  // outside Meta's 24-hour window (unset = only people who wrote to the Page that day are reached).
  MESSENGER_PAGE_ID: z.string().regex(/^\d+$/).optional(),
  MESSENGER_PAGE_ACCESS_TOKEN: z.string().min(1).optional(),
  MESSENGER_APP_SECRET: z.string().min(16).optional(),
  MESSENGER_VERIFY_TOKEN: z.string().min(16).optional(),
  MESSENGER_PAGE_USERNAME: z.string().regex(/^[A-Za-z0-9.]+$/).optional(),
  MESSENGER_UTILITY_TEMPLATE: z.string().regex(/^[a-z0-9_]+$/).optional(),
  MESSENGER_TEMPLATE_LANGUAGE: z.string().default("vi"),
  // Telegram (docs/TELEGRAM.md): a bot that delivers each person's own notifications to the
  // Telegram account they linked, beside Messenger. All three are needed together — with any
  // missing, the local driver records each message as "simulated" and nothing leaves the machine.
  // The token comes from @BotFather; the username is what the "connect" link opens
  // (t.me/<username>); the webhook secret is any random string, which Telegram sends back on
  // every webhook call.
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:\S+$/, "the token @BotFather gave, e.g. 123456:ABC…").optional(),
  TELEGRAM_BOT_USERNAME: z.string().regex(/^[A-Za-z0-9_]{5,32}$/).optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/, "generate with: openssl rand -hex 32").optional(),
  // Google Calendar for interview scheduling (FR-REC-06). A service account with domain-wide
  // delegation; `IMPERSONATE` is the mailbox the events are created as, which is what Google
  // requires before it will mint a Meet link. All four are needed together — with any of them
  // missing the local driver runs, the internal event and the .ics are unaffected, and nothing
  // leaves the machine. **The Google driver has never been run**: the company has no service
  // account, so it is written against the documented API and is untested.
  GOOGLE_CALENDAR_ID: z.string().min(1).optional(),
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_EMAIL: z.string().min(1).optional(),
  GOOGLE_CALENDAR_SERVICE_ACCOUNT_KEY: z.string().min(1).optional(),
  GOOGLE_CALENDAR_IMPERSONATE: z.string().min(1).optional(),
  // The shared read cache (Vercel's Data Cache, src/lib/cache) is on wherever the app runs in a
  // Vercel function and off everywhere else. `off` turns it off on Vercel too: every read goes to
  // Postgres. Never restricted or compensation data either way.
  DATA_CACHE: z.enum(["on", "off"]).optional(),
  // The Content-Security-Policy the proxy puts on every page (src/lib/csp.ts). "report-only", the
  // default, sends it as Content-Security-Policy-Report-Only: browsers block nothing and report
  // what they would have. "enforce" sends the same policy as the enforcing header — after the
  // reports have been read; "off" sends neither.
  CSP_MODE: z.enum(["report-only", "enforce", "off"]).default("report-only"),
  // Sentry's DSN, here only for that policy: the host the browser SDK posts to, and the endpoint
  // that takes violation reports, are both read off it. The SDK itself reads these names directly
  // (src/lib/observability), so any value passes here; one that is not a DSN is ignored.
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
});

/**
 * The S3 endpoint of the file bucket, without the bucket: the account's R2 endpoint, or
 * `R2_ENDPOINT`. The dashboard shows a bucket's S3 URL with the bucket's name on the end; pasted as
 * it is, that name is dropped here rather than doubled in every object's path.
 */
export function r2EndpointFor(input: { R2_ENDPOINT?: string; CLOUDFLARE_ACCOUNT_ID?: string; STORAGE_BUCKET: string }): string | undefined {
  if (input.R2_ENDPOINT) return input.R2_ENDPOINT.replace(/\/+$/, "").replace(new RegExp(`/${input.STORAGE_BUCKET}$`), "");
  return input.CLOUDFLARE_ACCOUNT_ID ? `https://${input.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined;
}

/** The local step-up driver skips Google, so it must never exist where real salaries do. */
export function stepUpDriverProblem(input: { driver: "google" | "local"; nodeEnv: string | undefined; vercelEnv: string | undefined }): string | null {
  if (input.driver !== "local") return null;
  if (input.nodeEnv === "production") return "the local driver is for development only and is refused in a production build";
  if (input.vercelEnv) return "the local driver is refused on Vercel (any environment)";
  return null;
}

/**
 * True only on a developer's own machine: never in a production build, never on Vercel. The one
 * place `NODE_ENV` may be read, so development-only tooling has a single honest gate.
 */
export function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV !== "production" && !process.env.VERCEL_ENV;
}

function load() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration (see .env.example):\n${problems}`);
  }
  const guard = stepUpDriverProblem({ driver: parsed.data.STEP_UP_DRIVER, nodeEnv: process.env.NODE_ENV, vercelEnv: process.env.VERCEL_ENV });
  if (guard) throw new Error(`Invalid environment configuration (see .env.example):\n  STEP_UP_DRIVER: ${guard}`);
  return {
    ...parsed.data,
    allowedWorkspaceDomains: csv(parsed.data.ALLOWED_WORKSPACE_DOMAINS),
    bootstrapOwnerEmails: csv(parsed.data.BOOTSTRAP_OWNER_EMAILS),
    r2Endpoint: r2EndpointFor(parsed.data),
  };
}

let cached: ReturnType<typeof load> | undefined;

// Lazy so that `next build` can import modules without a full runtime environment.
export function env() {
  return (cached ??= load());
}
