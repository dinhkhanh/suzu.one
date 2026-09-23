ALTER TABLE "daily_team_policy" ALTER COLUMN "plan_mode" SET DEFAULT 'required';--> statement-breakpoint
ALTER TABLE "daily_team_policy" ALTER COLUMN "report_days" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "daily_team_policy" ALTER COLUMN "report_deadline" SET DEFAULT '23:00';--> statement-breakpoint
ALTER TABLE "daily_team_policy" ALTER COLUMN "time_mode" SET DEFAULT 'required';--> statement-breakpoint
ALTER TABLE "daily_team_policy" ALTER COLUMN "timesheet_approval" SET DEFAULT true;