ALTER TABLE "project_change_request" ADD COLUMN "figures_before" jsonb;--> statement-breakpoint
ALTER TABLE "project_change_request" ADD COLUMN "figures_after" jsonb;--> statement-breakpoint
ALTER TABLE "project_plan" ADD COLUMN "close_history" jsonb DEFAULT '[]'::jsonb NOT NULL;