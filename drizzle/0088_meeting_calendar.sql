ALTER TABLE "project_meeting" ADD COLUMN "start_time" time;--> statement-breakpoint
ALTER TABLE "project_meeting" ADD COLUMN "duration_minutes" integer;--> statement-breakpoint
ALTER TABLE "project_meeting" ADD COLUMN "calendar_driver" text;--> statement-breakpoint
ALTER TABLE "project_meeting" ADD COLUMN "calendar_status" text;--> statement-breakpoint
ALTER TABLE "project_meeting" ADD COLUMN "calendar_error" text;--> statement-breakpoint
ALTER TABLE "project_meeting" ADD COLUMN "meeting_url" text;