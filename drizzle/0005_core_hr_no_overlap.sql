-- Effective-dated rows must never overlap (ADR-07). Drizzle cannot express exclusion constraints,
-- so they live here. btree_gist supplies the uuid equality operator for gist indexes; on Supabase
-- extensions belong in the `extensions` schema, which plain Postgres (tests, other hosts) lacks.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS btree_gist;
  END IF;
END $$;
--> statement-breakpoint
-- A person has one employment at a time (FR-PLT-12); a rehire starts after the previous period ends.
ALTER TABLE "employment" ADD CONSTRAINT "employment_no_overlap"
  EXCLUDE USING gist ("person_id" WITH =, daterange("start_date", "end_date", '[]') WITH &&);
--> statement-breakpoint
-- One primary assignment per employment on any given day.
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_primary_no_overlap"
  EXCLUDE USING gist ("employment_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("kind" = 'primary');
