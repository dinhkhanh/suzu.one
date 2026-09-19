CREATE TYPE "public"."job_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "job_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"status" "job_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "job_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "job_run_job_started_at_idx" ON "job_run" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_run_one_running_key" ON "job_run" USING btree ("job") WHERE "job_run"."status" = 'running';