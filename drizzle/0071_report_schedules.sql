CREATE TYPE "public"."report_cadence" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."report_run_status" AS ENUM('succeeded', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "report_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_key" text NOT NULL,
	"name" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cadence" "report_cadence" NOT NULL,
	"day_of_week" smallint,
	"day_of_month" smallint,
	"next_run_on" date NOT NULL,
	"last_run_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"locale" text DEFAULT 'vi' NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_schedule_recipient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"person_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_schedule_recipient" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_schedule_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"run_on" date NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" "report_run_status" NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"withheld" integer DEFAULT 0 NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_schedule_run" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_schedule" ADD CONSTRAINT "report_schedule_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_recipient" ADD CONSTRAINT "report_schedule_recipient_schedule_id_report_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_recipient" ADD CONSTRAINT "report_schedule_recipient_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedule_run" ADD CONSTRAINT "report_schedule_run_schedule_id_report_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."report_schedule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_schedule_due_idx" ON "report_schedule" USING btree ("next_run_on") WHERE "report_schedule"."is_active" AND "report_schedule"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "report_schedule_owner_idx" ON "report_schedule" USING btree ("created_by_person_id");--> statement-breakpoint
CREATE INDEX "report_schedule_recipient_idx" ON "report_schedule_recipient" USING btree ("schedule_id","person_id");--> statement-breakpoint
CREATE INDEX "report_schedule_run_idx" ON "report_schedule_run" USING btree ("schedule_id","run_on");