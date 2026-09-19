CREATE TYPE "public"."device_file_kind" AS ENUM('csv', 'xlsx', 'dat');--> statement-breakpoint
CREATE TYPE "public"."attendance_merge_rule" AS ENUM('first_in_last_out', 'prefer_device', 'prefer_app');--> statement-breakpoint
CREATE TYPE "public"."timesheet_day_status" AS ENUM('present', 'partial', 'absent', 'leave', 'holiday', 'day_off', 'rest', 'untracked', 'remote', 'unscheduled', 'in_progress');--> statement-breakpoint
CREATE TABLE "attendance_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"model" text,
	"serial_number" text,
	"location_id" uuid,
	"profile_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_device_entity_name_key" UNIQUE("entity_id","name")
);
--> statement-breakpoint
ALTER TABLE "attendance_device" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attendance_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"merge_rule" "attendance_merge_rule" DEFAULT 'first_in_last_out' NOT NULL,
	"grace_late_minutes" smallint DEFAULT 0 NOT NULL,
	"grace_early_minutes" smallint DEFAULT 0 NOT NULL,
	"rounding_minutes" smallint DEFAULT 0 NOT NULL,
	"ot_min_minutes" smallint DEFAULT 30 NOT NULL,
	"ot_requires_approval" boolean DEFAULT true NOT NULL,
	"duplicate_window_minutes" smallint DEFAULT 3 NOT NULL,
	"break_start" text DEFAULT '12:00' NOT NULL,
	"day_boundary" text DEFAULT '04:00' NOT NULL,
	"monthly_correction_cap" smallint,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_mapping_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"name" text NOT NULL,
	"device_model" text,
	"file_kind" "device_file_kind" NOT NULL,
	"mapping" jsonb NOT NULL,
	"timezone" text DEFAULT 'Asia/Ho_Chi_Minh' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_mapping_profile_name_key" UNIQUE NULLS NOT DISTINCT("entity_id","name")
);
--> statement-breakpoint
ALTER TABLE "device_mapping_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_unmapped_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"device_user_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"direction" "punch_direction",
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_unmapped_log_key" UNIQUE("device_id","device_user_id","at")
);
--> statement-breakpoint
ALTER TABLE "device_unmapped_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_user_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"device_user_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_user_map_key" UNIQUE("device_id","device_user_id")
);
--> statement-breakpoint
ALTER TABLE "device_user_map" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "timesheet_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid,
	"date" date NOT NULL,
	"plan_kind" text NOT NULL,
	"status" timesheet_day_status NOT NULL,
	"required_minutes" integer DEFAULT 0 NOT NULL,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"credited_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"early_minutes" integer DEFAULT 0 NOT NULL,
	"absence_minutes" integer DEFAULT 0 NOT NULL,
	"missing_punch" boolean DEFAULT false NOT NULL,
	"leave_paid_minutes" integer DEFAULT 0 NOT NULL,
	"leave_unpaid_minutes" integer DEFAULT 0 NOT NULL,
	"holiday_minutes" integer DEFAULT 0 NOT NULL,
	"wfh_minutes" integer DEFAULT 0 NOT NULL,
	"trip_minutes" integer DEFAULT 0 NOT NULL,
	"night_minutes" integer DEFAULT 0 NOT NULL,
	"ot_weekday_minutes" integer DEFAULT 0 NOT NULL,
	"ot_weekday_night_minutes" integer DEFAULT 0 NOT NULL,
	"ot_rest_day_minutes" integer DEFAULT 0 NOT NULL,
	"ot_rest_day_night_minutes" integer DEFAULT 0 NOT NULL,
	"ot_holiday_minutes" integer DEFAULT 0 NOT NULL,
	"ot_holiday_night_minutes" integer DEFAULT 0 NOT NULL,
	"ot_unapproved_minutes" integer DEFAULT 0 NOT NULL,
	"ot_time_off_minutes" integer DEFAULT 0 NOT NULL,
	"first_in" timestamp with time zone,
	"last_out" timestamp with time zone,
	"anomalies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inputs_hash" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "timesheet_day_person_date_key" UNIQUE("person_id","date")
);
--> statement-breakpoint
ALTER TABLE "timesheet_day" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_batch" ADD COLUMN "params" jsonb;--> statement-breakpoint
ALTER TABLE "punch" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "punch" ADD COLUMN "device_user_id" text;--> statement-breakpoint
ALTER TABLE "punch" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_device" ADD CONSTRAINT "attendance_device_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device" ADD CONSTRAINT "attendance_device_location_id_work_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."work_location"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_device" ADD CONSTRAINT "attendance_device_profile_id_device_mapping_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."device_mapping_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policy" ADD CONSTRAINT "attendance_policy_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_mapping_profile" ADD CONSTRAINT "device_mapping_profile_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_unmapped_log" ADD CONSTRAINT "device_unmapped_log_device_id_attendance_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_user_map" ADD CONSTRAINT "device_user_map_device_id_attendance_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_user_map" ADD CONSTRAINT "device_user_map_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_user_map" ADD CONSTRAINT "device_user_map_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_day" ADD CONSTRAINT "timesheet_day_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_day" ADD CONSTRAINT "timesheet_day_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_policy_entity_idx" ON "attendance_policy" USING btree ("entity_id","valid_from");--> statement-breakpoint
CREATE INDEX "device_user_map_person_idx" ON "device_user_map" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "timesheet_day_entity_date_idx" ON "timesheet_day" USING btree ("entity_id","date");--> statement-breakpoint
ALTER TABLE "punch" ADD CONSTRAINT "punch_device_id_attendance_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."attendance_device"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "punch_device_key" ON "punch" USING btree ("device_id","device_user_id","at") WHERE "punch"."device_id" is not null;