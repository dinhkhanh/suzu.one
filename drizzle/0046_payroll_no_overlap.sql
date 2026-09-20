-- Effective-dated payroll rows never overlap (ADR-07). btree_gist was installed by 0005.
-- Proposed and rejected versions may overlap anything: only what is in force is constrained.
ALTER TABLE "pay_profile" ADD CONSTRAINT "pay_profile_no_overlap"
  EXCLUDE USING gist ("employment_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("status" = 'approved');
--> statement-breakpoint
-- entity_id null = the group's catalogue, a scope of its own.
ALTER TABLE "pay_component" ADD CONSTRAINT "pay_component_no_overlap"
  EXCLUDE USING gist ((COALESCE("entity_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, "code" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("status" = 'approved');
--> statement-breakpoint
ALTER TABLE "payroll_policy" ADD CONSTRAINT "payroll_policy_no_overlap"
  EXCLUDE USING gist ((COALESCE("entity_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("status" = 'approved');
--> statement-breakpoint
-- Every salary structure is in force (it comes out of an approved request), so all rows count.
ALTER TABLE "salary_structure" ADD CONSTRAINT "salary_structure_no_overlap"
  EXCLUDE USING gist ("employment_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&);
