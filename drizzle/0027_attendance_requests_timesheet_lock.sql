CREATE TYPE "public"."attendance_request_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."attendance_request_type" AS ENUM('attendance_correction', 'remote_work', 'overtime', 'holiday_work');--> statement-breakpoint
CREATE TYPE "public"."timesheet_adjustment_status" AS ENUM('active', 'voided');--> statement-breakpoint
CREATE TYPE "public"."timesheet_month_status" AS ENUM('open', 'confirmed', 'approved', 'locked');--> statement-breakpoint
CREATE TYPE "public"."timesheet_period_status" AS ENUM('open', 'locked');--> statement-breakpoint
CREATE TABLE "attendance_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "attendance_request_type" NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"filed_by_person_id" uuid NOT NULL,
	"approval_request_id" uuid,
	"status" "attendance_request_status" DEFAULT 'pending' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"details" jsonb NOT NULL,
	"reason" text,
	"evidence_file_id" uuid,
	"compensation" text,
	"confirmed_minutes" integer,
	"confirmed_by_person_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_request" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_toil_posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"month" text NOT NULL,
	"minutes" integer NOT NULL,
	"amount_centi" integer NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_toil_posting_person_month_key" UNIQUE("person_id","month")
);
--> statement-breakpoint
ALTER TABLE "attendance_toil_posting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timesheet_adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"date" date,
	"deltas" jsonb NOT NULL,
	"reason" text NOT NULL,
	"status" timesheet_adjustment_status DEFAULT 'active' NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"voided_by_person_id" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"payroll_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timesheet_adjustment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timesheet_month" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"month" text NOT NULL,
	"status" timesheet_month_status DEFAULT 'open' NOT NULL,
	"summary" jsonb,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_person_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_person_id" uuid,
	"locked_at" timestamp with time zone,
	"locked_by_person_id" uuid,
	"reopened_comment" text,
	"reopened_by_person_id" uuid,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_month_person_month_key" UNIQUE("person_id","month"),
	CONSTRAINT "timesheet_month_format" CHECK ("timesheet_month"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "timesheet_month" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timesheet_period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"status" timesheet_period_status DEFAULT 'open' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by_person_id" uuid,
	"override_reason" text,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_period_entity_month_key" UNIQUE("entity_id","month"),
	CONSTRAINT "timesheet_period_month_format" CHECK ("timesheet_period"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "timesheet_period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_filed_by_person_id_person_id_fk" FOREIGN KEY ("filed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_approval_request_id_approval_request_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_request" ADD CONSTRAINT "attendance_request_confirmed_by_person_id_person_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_toil_posting" ADD CONSTRAINT "attendance_toil_posting_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_adjustment" ADD CONSTRAINT "timesheet_adjustment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_adjustment" ADD CONSTRAINT "timesheet_adjustment_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_adjustment" ADD CONSTRAINT "timesheet_adjustment_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_adjustment" ADD CONSTRAINT "timesheet_adjustment_voided_by_person_id_person_id_fk" FOREIGN KEY ("voided_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_month" ADD CONSTRAINT "timesheet_month_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_month" ADD CONSTRAINT "timesheet_month_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_month" ADD CONSTRAINT "timesheet_month_confirmed_by_person_id_person_id_fk" FOREIGN KEY ("confirmed_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_month" ADD CONSTRAINT "timesheet_month_approved_by_person_id_person_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_month" ADD CONSTRAINT "timesheet_month_locked_by_person_id_person_id_fk" FOREIGN KEY ("locked_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_month" ADD CONSTRAINT "timesheet_month_reopened_by_person_id_person_id_fk" FOREIGN KEY ("reopened_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_period" ADD CONSTRAINT "timesheet_period_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_period" ADD CONSTRAINT "timesheet_period_locked_by_person_id_person_id_fk" FOREIGN KEY ("locked_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_request_person_idx" ON "attendance_request" USING btree ("person_id","start_date");--> statement-breakpoint
CREATE INDEX "attendance_request_approval_idx" ON "attendance_request" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "attendance_request_entity_idx" ON "attendance_request" USING btree ("entity_id","start_date");--> statement-breakpoint
CREATE INDEX "timesheet_adjustment_entity_idx" ON "timesheet_adjustment" USING btree ("entity_id","month");--> statement-breakpoint
CREATE INDEX "timesheet_adjustment_person_idx" ON "timesheet_adjustment" USING btree ("person_id","month");--> statement-breakpoint
CREATE INDEX "timesheet_month_entity_idx" ON "timesheet_month" USING btree ("entity_id","month");