// Single entry point for drizzle-kit and the db client. Each module owns its own tables.
// Relative imports on purpose: drizzle-kit does not resolve the "@/..." path alias.
export * from "../../modules/platform/auth/schema";
export * from "../../modules/platform/org/schema";
export * from "../../modules/platform/people/schema";
export * from "../../modules/platform/rbac/schema";
export * from "../../modules/platform/audit/schema";
export * from "../../modules/platform/jobs/schema";
export * from "../../modules/platform/notifications/schema";
export * from "../../modules/platform/files/schema";
export * from "../../modules/platform/statutory/schema";
export * from "../../modules/platform/flags/schema";
export * from "../../modules/platform/import/schema";
export * from "../../modules/platform/approvals/schema";
export * from "../../modules/platform/tasks-engine/schema";
export * from "../../modules/core-hr/schema";
export * from "../../modules/attendance/schema";
export * from "../../modules/leave/schema";
export * from "../../modules/work/schema";
export * from "../../modules/ops/schema";
export * from "../../modules/performance/schema";

// Every table calls `.enableRLS()` with no policies. The app connects as the table owner, which
// bypasses row-level security; Supabase's public REST API roles (anon, authenticated) get nothing.
// tests/migrations.test.ts fails if a table in `public` is missing it.
