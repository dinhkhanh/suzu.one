import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  // Migrations need a direct (non-pooled) connection; on Vercel that is POSTGRES_URL_NON_POOLING.
  dbCredentials: { url: (process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL)! },
  strict: true,
});
