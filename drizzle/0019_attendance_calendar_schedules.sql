CREATE TYPE "public"."calendar_day_kind" AS ENUM('public_holiday', 'compensatory_off', 'company_off', 'working_override');--> statement-breakpoint
CREATE TYPE "public"."schedule_scope" AS ENUM('entity', 'department', 'person');--> statement-breakpoint
CREATE TYPE "public"."work_schedule_kind" AS ENUM('fixed', 'flexible', 'shift');--> statement-breakpoint
CREATE TABLE "calendar_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"date" date NOT NULL,
	"kind" "calendar_day_kind" NOT NULL,
	"name" text NOT NULL,
	"is_confirmed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_day_entity_date_key" UNIQUE NULLS NOT DISTINCT("entity_id","date")
);
--> statement-breakpoint
ALTER TABLE "calendar_day" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "schedule_assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" "schedule_scope" NOT NULL,
	"entity_id" uuid,
	"department_id" uuid,
	"person_id" uuid,
	"schedule_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"note" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schedule_assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"segments" jsonb NOT NULL,
	"break_minutes" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_entity_code_key" UNIQUE NULLS NOT DISTINCT("entity_id","code")
);
--> statement-breakpoint
ALTER TABLE "shift" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_roster" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_roster_person_date_key" UNIQUE("person_id","date")
);
--> statement-breakpoint
ALTER TABLE "shift_roster" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid,
	"name" text NOT NULL,
	"kind" "work_schedule_kind" NOT NULL,
	"pattern" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_schedule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_day" ADD CONSTRAINT "calendar_day_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_schedule_id_work_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."work_schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_assignment" ADD CONSTRAINT "schedule_assignment_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift" ADD CONSTRAINT "shift_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_roster" ADD CONSTRAINT "shift_roster_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedule" ADD CONSTRAINT "work_schedule_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_day_date_idx" ON "calendar_day" USING btree ("date");--> statement-breakpoint
CREATE INDEX "schedule_assignment_person_idx" ON "schedule_assignment" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "schedule_assignment_department_idx" ON "schedule_assignment" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "schedule_assignment_entity_idx" ON "schedule_assignment" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "work_schedule_entity_idx" ON "work_schedule" USING btree ("entity_id");