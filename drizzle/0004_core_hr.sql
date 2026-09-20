CREATE TYPE "public"."assignment_kind" AS ENUM('primary', 'secondary');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female', 'other');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('single', 'married', 'divorced', 'widowed');--> statement-breakpoint
CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employment_id" uuid NOT NULL,
	"kind" "assignment_kind" DEFAULT 'primary' NOT NULL,
	"workforce_type" "workforce_type" NOT NULL,
	"branch_id" uuid,
	"department_id" uuid,
	"team_id" uuid,
	"position_id" uuid,
	"job_level" text,
	"manager_id" uuid,
	"dotted_manager_id" uuid,
	"work_location" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"change_reason" text,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assignment_dates_check" CHECK ("assignment"."valid_to" IS NULL OR "assignment"."valid_to" >= "assignment"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_code_scheme" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"prefix" text NOT NULL,
	"padding" smallint DEFAULT 4 NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_code_scheme" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"start_date" date NOT NULL,
	"seniority_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employment_entity_code_key" UNIQUE("entity_id","employee_code"),
	CONSTRAINT "employment_dates_check" CHECK ("employment"."end_date" IS NULL OR "employment"."end_date" >= "employment"."start_date")
);
--> statement-breakpoint
ALTER TABLE "employment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person_profile" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"date_of_birth" date,
	"gender" "gender",
	"marital_status" "marital_status",
	"nationality" text,
	"phone" text,
	"personal_email" text,
	"permanent_address" text,
	"current_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"search_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "position_search_name_unique" UNIQUE("search_name")
);
--> statement-breakpoint
ALTER TABLE "position" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"list" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_view_owner_list_name_key" UNIQUE("owner_person_id","list","name")
);
--> statement-breakpoint
ALTER TABLE "saved_view" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "person" ALTER COLUMN "work_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_employment_id_employment_id_fk" FOREIGN KEY ("employment_id") REFERENCES "public"."employment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_department_id_department_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."department"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_position_id_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."position"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_manager_id_person_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_dotted_manager_id_person_id_fk" FOREIGN KEY ("dotted_manager_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_created_by_person_id_person_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_code_scheme" ADD CONSTRAINT "employee_code_scheme_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment" ADD CONSTRAINT "employment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employment" ADD CONSTRAINT "employment_entity_id_entity_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_profile" ADD CONSTRAINT "person_profile_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_person_id_person_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_employment_idx" ON "assignment" USING btree ("employment_id");--> statement-breakpoint
CREATE INDEX "assignment_department_idx" ON "assignment" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "assignment_manager_idx" ON "assignment" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "employment_person_idx" ON "employment" USING btree ("person_id");