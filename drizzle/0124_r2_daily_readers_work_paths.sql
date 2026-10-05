ALTER TABLE "work_recurrence" ADD COLUMN "on_day_off" text DEFAULT 'shift' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_saved_view" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_plan" ADD COLUMN "late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_report" ADD COLUMN "revisions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "work_saved_view" ADD CONSTRAINT "work_saved_view_team_id_work_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."work_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_recurrence_team_idx" ON "work_recurrence" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "work_saved_view_team_idx" ON "work_saved_view" USING btree ("team_id");--> statement-breakpoint
-- A saved view now names its team: a project's view takes the project's team. The column stays
-- nullable for the code still deployed, which does not write it; the new code always does.
UPDATE "work_saved_view" SET "team_id" = "work_project"."team_id" FROM "work_project" WHERE "work_saved_view"."project_id" = "work_project"."id" AND "work_saved_view"."team_id" IS NULL;
