-- Effective-dated attendance policies never overlap within one entity scope (ADR-07).
-- btree_gist was installed by 0005. entity_id null = the group's default, a scope of its own.
ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_dates" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
--> statement-breakpoint
ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_no_overlap"
  EXCLUDE USING gist ((COALESCE("entity_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, daterange("valid_from", "valid_to", '[]') WITH &&);
