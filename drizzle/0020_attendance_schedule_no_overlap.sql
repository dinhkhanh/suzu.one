-- Effective-dated schedule assignments must never overlap within one scope (ADR-07). btree_gist
-- was installed by 0005. A department assignment is for the shared department everywhere
-- (entity_id null) or narrowed to one entity; the two are different scopes and may coexist.
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_scope_shape" CHECK (
  ("scope" = 'person' AND "person_id" IS NOT NULL AND "department_id" IS NULL AND "entity_id" IS NULL) OR
  ("scope" = 'department' AND "department_id" IS NOT NULL AND "person_id" IS NULL) OR
  ("scope" = 'entity' AND "entity_id" IS NOT NULL AND "department_id" IS NULL AND "person_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_dates" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from");
--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_person_no_overlap"
  EXCLUDE USING gist ("person_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("scope" = 'person');
--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_department_no_overlap"
  EXCLUDE USING gist ("department_id" WITH =, (COALESCE("entity_id", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("scope" = 'department');
--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_entity_no_overlap"
  EXCLUDE USING gist ("entity_id" WITH =, daterange("valid_from", "valid_to", '[]') WITH &&)
  WHERE ("scope" = 'entity');
--> statement-breakpoint
-- One default schedule at most: the schedule of anyone no assignment covers.
CREATE UNIQUE INDEX "work_schedule_single_default" ON "work_schedule" ("is_default") WHERE "is_default";
