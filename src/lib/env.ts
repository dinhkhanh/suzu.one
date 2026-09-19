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
