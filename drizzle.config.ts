import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  // Migrations need a session-mode connection: POSTGRES_URL_NON_POOLING, as the Vercel–Supabase
  // integration names it. A local stack has no pooler, so its POSTGRES_URL serves both.
  dbCredentials: { url: (process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL)! },
  strict: true,
});
