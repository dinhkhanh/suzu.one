import "server-only";
import { z } from "zod";

const csv = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
  BETTER_AUTH_SECRET: z.string().min(32, "generate with: openssl rand -base64 32"),
  BETTER_AUTH_URL: z.url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ALLOWED_WORKSPACE_DOMAINS: z.string().default("suzu.vn,suzu.group"),
  BOOTSTRAP_OWNER_EMAILS: z.string().default(""),
  // Field encryption for restricted/compensation data: "k2:<base64 32 bytes>,k1:<...>", active key
  // first (docs/KEY_ROTATION.md). Losing these keys loses the data; they live only in the secret store.
  DATA_ENCRYPTION_KEYS: z.string().min(1).optional(),
  DATA_BLIND_INDEX_KEY: z.string().min(1).optional(),
  // Private file storage (Supabase Storage). On Vercel the Supabase integration provides both.
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  STORAGE_BUCKET: z.string().regex(/^[a-z0-9-]+$/).default("suzu-private"),
  // Outgoing email (Resend). Unset = emails are written to the outbox and marked "skipped".
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("Suzu One <no-reply@suzu.one>"),
  // Web push (VAPID, RFC 8292). Generate a pair with: pnpm push:keys. Unset = pushes are recorded as
  // "simulated" and nothing leaves the machine; browsers cannot subscribe without the public key.
  VAPID_PUBLIC_KEY: z.string().min(80).optional(),
  VAPID_PRIVATE_KEY: z.string().min(40).optional(),
  VAPID_SUBJECT: z.string().default("mailto:it@suzu.one"),
  // Shared with Vercel Cron, which sends it as a bearer token. Unset = scheduled jobs refuse to run.
  CRON_SECRET: z.string().min(16).optional(),
});

function load() {
  const parsed = schema.safeParse({
    ...process.env,
    // On Vercel the Supabase integration provides POSTGRES_URL (the pooled connection) instead.
    DATABASE_URL: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
  });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration (see .env.example):\n${problems}`);
  }
  return {
    ...parsed.data,
    allowedWorkspaceDomains: csv(parsed.data.ALLOWED_WORKSPACE_DOMAINS),
    bootstrapOwnerEmails: csv(parsed.data.BOOTSTRAP_OWNER_EMAILS),
  };
}

let cached: ReturnType<typeof load> | undefined;

// Lazy so that `next build` can import modules without a full runtime environment.
export function env() {
  return (cached ??= load());
}
