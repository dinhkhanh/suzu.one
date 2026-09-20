-- Effective-dated leave policies never overlap within one (leave type, entity) scope (ADR-07).
-- btree_gist was installed by 0005. entity_id null = the group's policy, a scope of its own.
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_dates" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
--> statement-breakpoint
ALTER TABLE "leave_policy" ADD CONSTRAINT "leave_policy_no_overlap"
  EXCLUDE USING gist ("leave_type_id" WITH =, (COALESCE("entity_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, daterange("valid_from", "valid_to", '[]') WITH &&);
--> statement-breakpoint
-- A request's dates are in order; a ledger row is never empty.
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_dates" CHECK ("end_date" >= "start_date");
--> statement-breakpoint
ALTER TABLE "leave_ledger_entry" ADD CONSTRAINT "leave_ledger_entry_not_zero" CHECK ("amount_centi" <> 0);
