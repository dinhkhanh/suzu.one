// Single entry point for drizzle-kit and the db client. Each module owns its own tables.
// Relative imports on purpose: drizzle-kit does not resolve the "@/..." path alias.
export * from "../../modules/platform/auth/schema";
export * from "../../modules/platform/org/schema";
export * from "../../modules/platform/people/schema";
export * from "../../modules/platform/rbac/schema";
export * from "../../modules/platform/audit/schema";

// Every table calls `.enableRLS()` with no policies. The app connects as the table owner, which
// bypasses row-level security; Supabase's public REST API roles (anon, authenticated) get nothing.
// tests/migrations.test.ts fails if a table in `public` is missing it.
