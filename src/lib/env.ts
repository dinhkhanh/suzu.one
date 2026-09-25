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
  ALLOWED_WORKSPACE_DOMAINS: z.string().default("suzu.vn,suzu.group"),
  BOOTSTRAP_OWNER_EMAILS: z.string().default(""),
  // Field encryption for restricted/compensation data: "k2:<base64 32 bytes>,k1:<...>", active key
  // first (docs/KEY_ROTATION.md). Losing these keys loses the data; they live only in the secret store.
  DATA_ENCRYPTION_KEYS: z.string().min(1).optional(),
  DATA_BLIND_INDEX_KEY: z.string().min(1).optional(),
  // Private file storage (Supabase Storage). The integration provides the URL and both keys: the
  // secret key (`sb_secret_…`) is the current kind and the one used; the service-role JWT is the
  // fallback for a local stack that only prints that one. Either is server-only.
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  STORAGE_BUCKET: z.string().regex(/^[a-z0-9-]+$/).default("suzu-private"),
  // Outgoing email (Resend). Unset = emails are written to the outbox and marked "skipped".
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("SuZu One <no-reply@suzu.one>"),
  // Web push (VAPID, RFC 8292). Generate a pair with: pnpm push:keys. Unset = pushes are recorded as
  // "simulated" and nothing leaves the machine; browsers cannot subscribe without the public key.
  VAPID_PUBLIC_KEY: z.string().min(80).optional(),
  VAPID_PRIVATE_KEY: z.string().min(40).optional(),
  VAPID_SUBJECT: z.string().default("mailto:it@suzu.one"),
  // Embeddings for the knowledge base (Voyage AI). Unset = a deterministic local fake: chunks are
  // still cut, stored and ranked, but the vectors mean nothing outside this machine.
  EMBEDDINGS_API_KEY: z.string().min(1).optional(),
  EMBEDDINGS_MODEL: z.string().min(1).default("voyage-3.5"),
  // The assistant's model (Phase 9, FR-AI-01). Unset = the local extractive driver: it answers with
  // the knowledge base's own words, generates nothing, and nothing leaves the machine. With a key
  // the Claude driver runs instead — **written against the Messages API and never run**, because
  // the company has no key. Zero data retention (FR-AI-06) is a setting on the Anthropic
  // organisation the key belongs to, not a request parameter: the owner has to ask for it.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5"),
  // Step-up re-authentication before compensation screens (FR-PLT-06). "google" sends the person
  // through Google again; "local" is a confirm button for development machines, where Google
  // cannot be reached — `load()` refuses it in any production build or on Vercel.
  STEP_UP_DRIVER: z.enum(["google", "local"]).default("google"),
  // Shared with Vercel Cron, which sends it as a bearer token. Unset = scheduled jobs refuse to run.
  CRON_SECRET: z.string().min(16).optional(),
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
  // Shared read cache (Upstash Redis over REST; the Vercel integration provides both). Unset = no
  // cache: every read goes to Postgres. Only reference data and non-sensitive counters are cached
  // (src/lib/cache): never personal, restricted or compensation data.
  KV_REST_API_URL: z.url().optional(),
  KV_REST_API_TOKEN: z.string().min(1).optional(),
});

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
    supabaseSecretKey: parsed.data.SUPABASE_SECRET_KEY ?? parsed.data.SUPABASE_SERVICE_ROLE_KEY,
  };
}

let cached: ReturnType<typeof load> | undefined;

// Lazy so that `next build` can import modules without a full runtime environment.
export function env() {
  return (cached ??= load());
}
